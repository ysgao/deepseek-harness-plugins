/**
 * Authorization redirects delivered over the `dsh` web server.
 *
 * `dsh-plugins-mcp-client-oauth`'s ordinary path is a loopback listener bound
 * on the machine running `dsh`, which the authorization server's redirect
 * reaches only when the human's browser is on that same machine. Opening the
 * web UI from a laptop, or reaching `dsh` over SSH, leaves that redirect
 * landing on the *browser's* own `127.0.0.1`, where nothing is listening, and
 * the sign-in falls back to pasting the redirected URL by hand.
 *
 * This plugin closes that gap with the server that is already serving the UI:
 * any browser that can open Settings can also reach `/mcp-oauth/callback`, so
 * registering that URL with the OAuth client makes the round trip automatic
 * from anywhere. The code is redeemed host-side exactly as before; nothing
 * about the grant, its storage, or its refresh changes.
 *
 * Two deliberate shapes:
 *
 *   * The **service is provided unconditionally, the route is not.** The sink
 *     is what `dsh-plugins-mcp-client-oauth` looks up; the route needs a web
 *     server, which a CLI profile has none of. Requiring `webServer` at the
 *     top level would leave this entry pending forever there, and this repo's
 *     Client boot treats a pending top-level entry as fatal to the whole
 *     application (ARCHITECTURE.md's "Plugin isolation"). So the web server is
 *     required through a nested `ctx.inject` instead, and a profile without one
 *     simply never delivers through this path.
 *   * **No `state` is minted or checked here.** The sink hands a delivery to
 *     whichever attempt registered that exact `state`, and an unclaimed
 *     `state` is answered with a page that says so. The nonce comparison
 *     stays in the flow that minted it, which is the only place that knows
 *     what it sent.
 *
 * @module dsh-plugins-host-oauth-callback-mcp-connector
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import type { McpOAuthCallbackDelivery, McpOAuthCallbackSink } from 'dsh-plugins-mcp-client-oauth'
// Side-effect type import: declaration-merges `ctx.webServer` onto Context.
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-oauth-callback'

/**
 * The pathname this plugin answers.
 *
 * Shared with the loopback listener's own default path deliberately: a human
 * moving from `http://127.0.0.1:33418/mcp-oauth/callback` to
 * `https://<host>/mcp-oauth/callback` changes only the origin, and an OAuth
 * client may carry both without either looking like a different thing.
 */
export const CALLBACK_PATH = '/mcp-oauth/callback'

/** One attempt waiting for its redirect. */
interface Waiting {
  resolve: (delivery: McpOAuthCallbackDelivery) => void
  reject: (error: Error) => void
}

/** What the browser is shown once its redirect has been handed over (or could not be). */
function page(title: string, detail: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
    + `<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;`
    + `background:#f6f6f7;color:#1c1c1e}main{max-width:32rem;padding:2rem;text-align:center}`
    + `h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#5a5a5f}`
    + `@media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#f6f6f7}p{color:#a8a8ad}}</style></head>`
    + `<body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`
}

/** Answer one request with an HTML page. */
function respond(res: ServerResponse, status: number, title: string, detail: string): void {
  const body = page(title, detail)
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // The URL carries an authorization code: it must not be kept anywhere.
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/**
 * `ctx.mcpOAuthCallbacks`: authorization redirects arriving over HTTP, routed
 * to the attempt that is waiting for each one.
 */
export class McpOAuthCallbacks extends Service implements McpOAuthCallbackSink {
  /** @inheritdoc */
  readonly path = CALLBACK_PATH

  private readonly waiting = new Map<string, Waiting>()

  /** @param ctx - host context. */
  constructor(ctx: Context) {
    super(ctx, 'mcpOAuthCallbacks')
  }

  /** @inheritdoc */
  await(state: string, signal: AbortSignal): Promise<McpOAuthCallbackDelivery> {
    return new Promise<McpOAuthCallbackDelivery>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('mcp-oauth-callback: the wait was retired'))
        return
      }
      // One `state` belongs to one attempt. A second registration under the
      // same value could only come from a `randomUUID` collision or a caller
      // reusing a nonce, and silently replacing the first would strand it.
      if (this.waiting.has(state)) {
        reject(new Error('mcp-oauth-callback: another attempt is already waiting under that state'))
        return
      }
      this.waiting.set(state, { resolve, reject })
      const retire = (): void => {
        this.waiting.delete(state)
        reject(signal.reason instanceof Error ? signal.reason : new Error('mcp-oauth-callback: the wait was retired'))
      }
      signal.addEventListener('abort', retire, { once: true })
    })
  }

  /**
   * Hand one redirect to the attempt waiting under its `state`.
   * @param url - the request URL, absolute or origin-relative.
   * @returns how the browser should be answered.
   */
  private deliver(url: URL): { status: number; title: string; detail: string } {
    const state = url.searchParams.get('state')
    if (state === null) {
      return { status: 400, title: 'Nothing to sign in', detail: 'That redirect carried no state parameter.' }
    }
    const pending = this.waiting.get(state)
    if (pending === undefined) {
      return {
        status: 404,
        title: 'No sign-in is waiting',
        detail: 'This sign-in already finished, was cancelled, or belongs to another dsh instance.',
      }
    }
    this.waiting.delete(state)
    const failure = url.searchParams.get('error')
    if (failure !== null) {
      const description = url.searchParams.get('error_description')
      pending.reject(new Error(
        `mcp-oauth-callback: the authorization server refused the request (${failure})`
        + `${description === null ? '' : `: ${description}`}`,
      ))
      return { status: 200, title: 'Sign-in refused', detail: 'You can close this tab and read the reason in dsh.' }
    }
    const code = url.searchParams.get('code')
    if (code === null) {
      pending.reject(new Error('mcp-oauth-callback: the redirect carried no authorization code'))
      return { status: 400, title: 'Sign-in incomplete', detail: 'That redirect carried no authorization code.' }
    }
    const issuer = url.searchParams.get('iss')
    pending.resolve({ code, ...issuer === null ? {} : { iss: issuer } })
    return { status: 200, title: 'Signed in', detail: 'You can close this tab and go back to dsh.' }
  }

  /**
   * The web server handler, bound to this sink.
   * @param req - the incoming redirect.
   * @param res - its response.
   */
  readonly handle = (req: IncomingMessage, res: ServerResponse): void => {
    let url: URL
    try {
      url = new URL(req.url ?? '', 'http://localhost')
    } catch {
      respond(res, 400, 'Bad request', 'That URL could not be read.')
      return
    }
    const answer = this.deliver(url)
    respond(res, answer.status, answer.title, answer.detail)
  }
}

/**
 * Publish the sink, and register the route once a web server exists.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  // Constructing the Service publishes `ctx.mcpOAuthCallbacks` and unregisters
  // it with this fiber; no separate `ctx.set`, which Cordis would refuse as a
  // second provision of one name.
  const callbacks = new McpOAuthCallbacks(ctx)
  // Nested, not a top-level `inject`: a profile with no web server (the CLI's
  // own) must keep working, with the loopback listener and the paste prompt
  // unaffected.
  void ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: CALLBACK_PATH, handler: callbacks.handle }),
      'mcp-oauth-callback.route',
    )
  })
}
