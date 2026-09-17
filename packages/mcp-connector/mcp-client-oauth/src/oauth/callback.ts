/**
 * The loopback half of the authorization-code leg: a listener bound to
 * exactly the configured redirect URI's host, port, and path, alive only for
 * the duration of one attempt, that catches the authorization server's
 * redirect and hands back the `code`.
 *
 * Bound to the configured URI rather than an ephemeral port because an
 * authorization server compares `redirect_uri` byte for byte against what the
 * client registered (RFC 6749 §3.1.2.3), so the port is part of the
 * registration and cannot be chosen at runtime. Google's console registers it
 * that way too.
 *
 * @module dsh-plugins-mcp-client-oauth/oauth/callback
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** What the authorization server sent back on the redirect. */
export interface CallbackResult {
  /** The authorization code to redeem. */
  code: string
  /** RFC 9207 `iss`, when the authorization server sent one, for mix-up defense. */
  iss?: string
}

/** Page shown in the human's browser once the code has been captured. */
function completionPage(title: string, detail: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>`
    + '<body style="font:16px system-ui;margin:4rem auto;max-width:34rem;padding:0 1rem">'
    + `<h1 style="font-size:1.25rem">${title}</h1><p>${detail}</p></body>`
}

/**
 * Listen for one authorization redirect.
 *
 * Resolves on the first request that reaches the redirect URI's own path
 * carrying the expected `state`. A request that arrives with the wrong
 * `state` — a stale tab from an earlier attempt, or an unrelated local
 * process that found the open port — is answered and ignored rather than
 * resolving the attempt, since redeeming its `code` is exactly the confused-
 * deputy the nonce exists to prevent.
 *
 * @param redirectUri - the configured redirect URI; its host, port, and path are all honoured.
 * @param expectedState - the `state` nonce this attempt sent.
 * @param signal - the attempt's cancellation; aborting closes the listener and rejects.
 * @returns the captured code, once the human finishes consenting.
 * @throws when the authorization server redirects with an `error`, when the
 *   port cannot be bound, or when `signal` aborts.
 */
export async function awaitAuthorizationCallback(
  redirectUri: string,
  expectedState: string,
  signal: AbortSignal,
): Promise<CallbackResult> {
  const target = new URL(redirectUri)
  const port = Number.parseInt(target.port, 10)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `mcp-client-oauth: redirectUri "${redirectUri}" must name an explicit port for the loopback listener to bind`,
    )
  }
  return await new Promise<CallbackResult>((resolve, reject) => {
    let settled = false
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // A bare `/` probe (a human checking the port, a browser prefetch) is
      // answered without disturbing the attempt.
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      if (url.pathname !== target.pathname) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
        res.end(completionPage('Not found', 'This is the dsh MCP sign-in callback listener.'))
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (error === null && code !== null && state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end(completionPage(
          'Sign-in could not be matched',
          'This callback did not carry the state value of the sign-in attempt that is waiting. '
          + 'It was ignored. Start the sign-in again from dsh.',
        ))
        return
      }
      if (error !== null) {
        const description = url.searchParams.get('error_description')
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end(completionPage('Sign-in failed', `${error}${description === null ? '' : `: ${description}`}`))
        finish(() => {
          reject(new Error(
            `mcp-client-oauth: the authorization server refused the request (${error})`
            + `${description === null ? '' : `: ${description}`}`,
          ))
        })
        return
      }
      if (code === null) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end(completionPage('Sign-in failed', 'The authorization server sent no authorization code.'))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(completionPage('Signed in', 'You can close this tab and go back to dsh.'))
      const iss = url.searchParams.get('iss')
      finish(() => { resolve({ code, ...iss === null ? {} : { iss } }) })
    })

    /** Settle once, and only after the listener is closed, so the port is free for the next attempt. */
    function finish(settle: () => void): void {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      server.close(() => { settle() })
      // A browser that keeps the connection alive would otherwise hold
      // `close()`'s callback until it times out.
      server.closeAllConnections()
    }

    const onAbort = (): void => {
      finish(() => { reject(signal.reason ?? new Error('mcp-client-oauth: the sign-in attempt was withdrawn')) })
    }
    signal.addEventListener('abort', onAbort, { once: true })

    server.on('error', (cause: NodeJS.ErrnoException) => {
      finish(() => {
        reject(cause.code === 'EADDRINUSE'
          ? new Error(
            `mcp-client-oauth: ${target.host} is already in use, so the sign-in callback cannot be received — `
            + 'close whatever is listening there, or register a different redirect URI with the OAuth client',
            { cause },
          )
          : cause)
      })
    })
    // Bound to the redirect URI's own hostname, so a URI naming 127.0.0.1
    // never accidentally opens the port on every interface.
    server.listen(port, target.hostname)
  })
}
