/**
 * The seam a browser redirect can arrive through when it cannot reach the
 * loopback listener.
 *
 * The listener in `./callback.ts` binds the redirect URI's own host and port
 * on the machine running `dsh`. That is exactly right for a human sitting at
 * that machine and useless for one whose browser is somewhere else — a `dsh`
 * reached over SSH, or its web UI opened from a laptop — because the
 * authorization server redirects *their* browser, which then resolves
 * `127.0.0.1` to their own machine, where nothing is listening. Today that
 * falls back to pasting the redirected URL by hand.
 *
 * A `dsh` that already serves a web UI has a better answer available: let the
 * redirect land on that server, which every browser that can reach the UI can
 * also reach. This interface is how the flow accepts such a delivery without
 * depending on a web server existing.
 *
 * Declared here, in the consumer, rather than in the package that implements
 * it: this package must compile and run in a profile with no web server at
 * all (the CLI's own profile has none), so it can hold the contract but never
 * the dependency. The implementing plugin provides the service under this
 * name; `ctx.get('mcpOAuthCallbacks')` returning undefined is the ordinary
 * case, not a failure.
 *
 * @module dsh-plugins-mcp-client-oauth/oauth/callback-sink
 */

/** One authorization redirect, as the sink received it. */
export interface McpOAuthCallbackDelivery {
  /** The authorization code the server sent. */
  code: string
  /** RFC 9207 issuer identifier, when the authorization server sent one. */
  iss?: string
}

/** Receives authorization redirects that arrive over an already-running HTTP server. */
export interface McpOAuthCallbackSink {
  /** The absolute pathname the sink answers on, for matching a configured redirect URI against it. */
  readonly path: string
  /**
   * Wait for the redirect carrying one attempt's `state`.
   *
   * @param state - the nonce this attempt sent; a delivery carrying any other
   *   value belongs to a different attempt and must not resolve this one.
   * @param signal - retires the wait when another racer wins, or the human gives up.
   * @returns the code, once a matching redirect arrives.
   */
  await(state: string, signal: AbortSignal): Promise<McpOAuthCallbackDelivery>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Authorization redirects delivered over the web server, for browsers
     * that cannot reach the loopback listener. Optional by design — read it
     * with `ctx.get('mcpOAuthCallbacks')`, never a top-level `inject`.
     */
    mcpOAuthCallbacks: McpOAuthCallbackSink
  }
}
