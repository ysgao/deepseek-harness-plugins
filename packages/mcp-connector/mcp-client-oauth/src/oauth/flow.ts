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
// Side-effect type import: declaration-merges the optional
// `ctx.mcpOAuthCallbacks` sink onto Context. Optional by design — see that
// module's doc comment.
import type {} from './callback-sink.ts'
import type { McpOAuthCallbackSink } from './callback-sink.ts'

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
    const callback = await raceForCode(serverName, provider.redirectUrl, state, session, ctx.get('mcpOAuthCallbacks'))
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
 * Whether a redirect URI names a host the loopback listener can usefully bind.
 *
 * A non-loopback URI is not a misconfiguration — it is how a redirect is
 * routed through the web server instead — so the listener is skipped rather
 * than attempted and reported as broken.
 *
 * @param redirectUri - the configured redirect URI.
 * @returns true when the URI names loopback.
 */
function isLoopbackRedirect(redirectUri: string): boolean {
  let host: string
  try {
    host = new URL(redirectUri).hostname
  } catch {
    return false
  }
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
}

/**
 * Whether a sink can receive this attempt's redirect.
 *
 * The sink answers one pathname on the web server; a redirect URI pointing
 * somewhere else will never reach it, and entering it in the race would leave
 * a wait that can only ever lose.
 *
 * @param sink - the sink, when one is mounted.
 * @param redirectUri - the configured redirect URI.
 * @returns true when the URI's path is the one the sink answers.
 */
function sinkServes(sink: McpOAuthCallbackSink | undefined, redirectUri: string): boolean {
  if (sink === undefined) return false
  try {
    return new URL(redirectUri).pathname === sink.path
  } catch {
    return false
  }
}

/**
 * Wait for the authorization code, from whichever way produces it first.
 *
 * Up to three ways run at once, and which of them are live depends on the
 * redirect URI rather than on configuration:
 *
 *   * the **loopback listener**, for a `127.0.0.1`/`localhost` redirect URI —
 *     the ordinary case, and the only one that needs nothing else mounted;
 *   * the **web-server sink**, when one is mounted and the redirect URI names
 *     its path. This is what makes a browser on another machine work: the
 *     authorization server redirects that browser to the `dsh` web server,
 *     which every browser that can open the UI can also reach, and the code
 *     never touches the human's clipboard;
 *   * the **paste prompt**, always, because neither of the other two can be
 *     promised in every deployment.
 *
 * The losers are retired through their own `signal` — the seam documents that
 * exact use for the prompt, so withdrawing the question does not read as the
 * human declining.
 *
 * @param serverName - the connector being authorized, for diagnostics.
 * @param redirectUri - the configured redirect URI.
 * @param state - the nonce this attempt sent.
 * @param session - the seam's handle on the human.
 * @param sink - the web-server delivery seam, when one is mounted.
 * @returns the captured code.
 */
async function raceForCode(
  serverName: string,
  redirectUri: string,
  state: string,
  session: AuthorizationSession,
  sink: McpOAuthCallbackSink | undefined,
): Promise<CallbackResult> {
  const controllers: AbortController[] = []
  const contenders: Promise<CallbackResult>[] = []
  const withdraw = (reason: string): void => {
    for (const controller of controllers) {
      controller.abort(new Error(`mcp-client-oauth(${serverName}): ${reason}`))
    }
  }
  const abandon = (): void => { withdraw('the sign-in attempt ended') }
  session.signal.addEventListener('abort', abandon, { once: true })

  /**
   * Enter one way of receiving the code into the race, with its own signal.
   * @param won - what to say when this one wins, retiring the others.
   * @param start - begins the wait under the signal that retires it.
   */
  const enter = (won: string, start: (signal: AbortSignal) => Promise<CallbackResult>): Promise<CallbackResult> => {
    const done = new AbortController()
    controllers.push(done)
    const attempt = start(done.signal)
    contenders.push(attempt.then((result) => {
      for (const other of controllers) {
        if (other !== done) other.abort(new Error(`mcp-client-oauth(${serverName}): ${won}`))
      }
      return result
    }))
    return attempt
  }

  if (isLoopbackRedirect(redirectUri)) {
    const listening = enter(
      'the browser redirect arrived',
      signal => awaitAuthorizationCallback(redirectUri, state, signal),
    )
    // A listener that could not bind its port is not a reason to fail the
    // whole attempt — the paste path still works — but it must be reported,
    // or the human is left staring at a prompt with no idea why the browser
    // round trip did nothing.
    listening.catch((error: unknown) => {
      if (controllers[0]?.signal.aborted === true) return
      session.notify({
        message: `Could not receive the browser redirect automatically (${
          error instanceof Error ? error.message : String(error)
        }). Paste the URL your browser was redirected to instead.`,
      })
    })
  }

  if (sinkServes(sink, redirectUri)) {
    // Non-null: sinkServes is false for an absent sink.
    const served = sink as McpOAuthCallbackSink
    enter('the browser redirect reached the web server', signal => served.await(state, signal))
  }

  enter('the redirect URL was pasted', signal => session.prompt({
    kind: 'text',
    message: 'Paste the full URL your browser was redirected to, if it did not return here by itself.',
    placeholder: `${redirectUri}?code=...`,
    signal,
  }).then(pasted => parsePastedRedirect(serverName, pasted, state)))

  try {
    return await Promise.race(contenders)
  } finally {
    session.signal.removeEventListener('abort', abandon)
    abandon()
    // Every side is settled or withdrawn; marking the losers handled keeps an
    // orphaned rejection from reaching the process.
    for (const contender of contenders) void contender.catch(() => {})
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
