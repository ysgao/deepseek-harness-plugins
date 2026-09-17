/**
 * The interactive half of the OAuth bridge, expressed as a
 * `ctx.authorization` flow.
 *
 * The seam's own contract is a good fit and is used as written: a flow is
 * keyed by the credential record it writes, it talks to whatever surface
 * started it through one neutral vocabulary of notices and prompts, and it
 * must commit through `ctx.credentials` *during* the attempt for the seam to
 * report success. All three fall out naturally here — the record is the
 * connector's grant, the notice carries the consent URL, and the commit is
 * the SDK's own `saveTokens` call landing in {@link McpOAuthStore}.
 *
 * Registering here rather than driving a browser directly is what makes one
 * sign-in work from three places at once: the Settings page, the CLI, and any
 * other surface that renders the seam, all without this file knowing which of
 * them is watching.
 *
 * @module dsh-plugins-mcp-client-oauth/oauth/flow
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { auth } from '@modelcontextprotocol/client'
import { awaitAuthorizationCallback } from './callback.ts'
import type { CallbackResult } from './callback.ts'
import { McpOAuthProvider } from './provider.ts'

/** The one method this flow offers; a single-method flow renders as one button. */
const METHOD = { id: 'browser', label: 'Sign in with your browser' } as const

/**
 * Run one authorization-code attempt for a connector.
 *
 * The consent leg races two ways of getting the code back, and retires the
 * loser through the prompt's own `signal` — the seam documents that exact
 * use. The loopback listener is the ordinary path; the paste prompt is what
 * keeps a `dsh` reached over SSH, or one whose redirect port is occupied,
 * authorizable at all, since the human's browser is then on a different
 * machine from the listener.
 *
 * @param ctx - context carrying `ctx.credentials`.
 * @param serverName - the connector being authorized.
 * @param serverUrl - the MCP endpoint, the protected resource being authorized against.
 * @param provider - the connector's persisted-credential half.
 * @param session - the seam's handle on the human.
 */
export async function runOAuthAttempt(
  ctx: Context,
  serverName: string,
  serverUrl: string,
  provider: McpOAuthProvider,
  session: AuthorizationSession,
): Promise<void> {
  const state = randomUUID()
  let redirected: URL | undefined
  const release = provider.withRedirect((url) => {
    redirected = url
    session.notify({
      message: `Open this page to authorize "${serverName}", then come back here.`,
      url: url.toString(),
    })
  }, state)
  try {
    const first = await auth(provider, { serverUrl })
    if (first === 'AUTHORIZED') {
      // The stored refresh token was still good: nothing was asked of the
      // human, and `saveTokens` has already committed the new access token.
      session.notify({ message: `"${serverName}" was renewed without signing in again.` })
      return
    }
    /* v8 ignore next 3 -- `auth()` returns REDIRECT only after calling redirectToAuthorization, which sets this. */
    if (redirected === undefined) {
      throw new Error(`mcp-client-oauth(${serverName}): the SDK asked for a redirect without producing a URL`)
    }
    const callback = await raceForCode(serverName, provider.redirectUrl, state, session)
    const second = await auth(provider, {
      serverUrl,
      authorizationCode: callback.code,
      ...callback.iss === undefined ? {} : { iss: callback.iss },
    })
    if (second !== 'AUTHORIZED') {
      throw new Error(
        `mcp-client-oauth(${serverName}): the authorization code was accepted but no tokens were issued`,
      )
    }
    ctx.logger.info(`mcp-client-oauth(${serverName}): authorized`)
  } finally {
    release()
  }
}

/**
 * Wait for the authorization code, from whichever of the two ways produces it
 * first.
 * @param serverName - the connector being authorized, for diagnostics.
 * @param redirectUri - the configured redirect URI the listener binds.
 * @param state - the nonce this attempt sent.
 * @param session - the seam's handle on the human.
 * @returns the captured code.
 */
async function raceForCode(
  serverName: string,
  redirectUri: string,
  state: string,
  session: AuthorizationSession,
): Promise<CallbackResult> {
  // One controller per side, each aborting the other's wait once this side
  // wins. The prompt's own `signal` is the seam's documented way to retire
  // the losing question of a race without it reading as a human declining.
  const listenerDone = new AbortController()
  const promptDone = new AbortController()
  const withdraw = (): void => {
    listenerDone.abort(new Error(`mcp-client-oauth(${serverName}): the sign-in attempt ended`))
    promptDone.abort(new Error(`mcp-client-oauth(${serverName}): the sign-in attempt ended`))
  }
  session.signal.addEventListener('abort', withdraw, { once: true })

  const listening = awaitAuthorizationCallback(redirectUri, state, listenerDone.signal)
  // A listener that could not bind its port is not a reason to fail the whole
  // attempt — the paste path still works — but it must be reported, or the
  // human is left staring at a prompt with no idea why the browser round trip
  // did nothing.
  listening.catch((error: unknown) => {
    if (listenerDone.signal.aborted) return
    session.notify({
      message: `Could not receive the browser redirect automatically (${
        error instanceof Error ? error.message : String(error)
      }). Paste the URL your browser was redirected to instead.`,
    })
  })

  const pasting = session.prompt({
    kind: 'text',
    message: 'Paste the full URL your browser was redirected to, if it did not return here by itself.',
    placeholder: `${redirectUri}?code=...`,
    signal: promptDone.signal,
  }).then(pasted => parsePastedRedirect(serverName, pasted, state))

  try {
    return await Promise.race([
      listening.then((result) => {
        promptDone.abort(new Error(`mcp-client-oauth(${serverName}): the browser redirect arrived`))
        return result
      }),
      pasting.then((result) => {
        listenerDone.abort(new Error(`mcp-client-oauth(${serverName}): the redirect URL was pasted`))
        return result
      }),
    ])
  } finally {
    session.signal.removeEventListener('abort', withdraw)
    withdraw()
    // Both sides are settled or withdrawn; marking the loser handled keeps an
    // orphaned rejection from reaching the process.
    void listening.catch(() => {})
    void pasting.catch(() => {})
  }
}

/**
 * Read a code out of a redirect URL the human pasted.
 * @param serverName - the connector being authorized, for diagnostics.
 * @param pasted - whatever the human typed.
 * @param state - the nonce this attempt sent.
 * @returns the captured code.
 * @throws when the paste is not a URL, carries an error, or echoes a different attempt's `state`.
 */
function parsePastedRedirect(serverName: string, pasted: string, state: string): CallbackResult {
  let url: URL
  try {
    url = new URL(pasted.trim())
  } catch {
    throw new Error(`mcp-client-oauth(${serverName}): "${pasted.trim()}" is not a URL`)
  }
  const error = url.searchParams.get('error')
  if (error !== null) {
    const description = url.searchParams.get('error_description')
    throw new Error(
      `mcp-client-oauth(${serverName}): the authorization server refused the request (${error})`
      + `${description === null ? '' : `: ${description}`}`,
    )
  }
  const code = url.searchParams.get('code')
  if (code === null) throw new Error(`mcp-client-oauth(${serverName}): that URL carries no authorization code`)
  if (url.searchParams.get('state') !== state) {
    throw new Error(
      `mcp-client-oauth(${serverName}): that URL belongs to a different sign-in attempt — `
      + 'start the sign-in again and paste the URL it produces',
    )
  }
  const iss = url.searchParams.get('iss')
  return { code, ...iss === null ? {} : { iss } }
}

/**
 * Register one connector's authorization flow, for as long as the calling
 * fiber lives.
 *
 * Registered through a nested `ctx.inject(['authorization'])` by the caller,
 * never a top-level `inject`: a connector whose profile has no authorization
 * seam mounted must still bridge its tools (a stdio or static-header server
 * needs none), and this repo's Client/Host boot treats a top-level entry left
 * pending as fatal to the whole application rather than to one feature.
 *
 * @param ctx - the already-satisfied scope carrying `ctx.authorization`.
 * @param serverName - the connector being authorized.
 * @param label - the human-facing name of what is being authorized.
 * @param serverUrl - the MCP endpoint.
 * @param provider - the connector's persisted-credential half.
 * @returns disposer withdrawing the flow.
 */
export function registerOAuthFlow(
  ctx: Context,
  serverName: string,
  label: string,
  serverUrl: string,
  provider: McpOAuthProvider,
): () => void {
  return ctx.authorization.registerFlow({
    key: provider.credentialKey,
    label,
    methods: [METHOD],
    run: session => runOAuthAttempt(ctx, serverName, serverUrl, provider, session),
  })
}
