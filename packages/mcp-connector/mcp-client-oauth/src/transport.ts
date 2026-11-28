/**
 * Transport factory. A fork of
 * `@deepseek-ai/dsh-mcp-client`'s own `src/transport.ts` (vendor pin
 * `841f76d3`), which this package's `src/connection.ts` fork imports in its
 * place.
 *
 * What changed, and nothing else did: the `streamable-http-oauth` case, and
 * the `authProvider` it hands the SDK. The other two cases — the stdio child
 * with `scrubbedParentEnv()`, and the static-header Streamable HTTP URL — are
 * the vendor's own code, kept byte-for-byte so a profile that moves a server
 * from `@deepseek-ai/dsh-mcp-client` to this package sees no behaviour change
 * at all.
 *
 * At vendor pin `841f76d3` the plain `streamable-http` case itself grew two
 * optional passthrough parameters, `fetch` and `authProvider`, which the
 * vendor's own `connection.ts` now supplies for ITS native `config.oauth`
 * (a different, non-overlapping config shape from this package's own
 * `streamable-http-oauth` transport — see `index.ts`). This fork keeps that
 * passthrough on the shared `streamable-http` case verbatim, and reuses the
 * very same `authProvider` parameter for its own OAuth case: the SDK's
 * `StreamableHTTPClientTransportOptions.authProvider` already accepts either
 * an `AuthProvider` or an `OAuthClientProvider`, and `McpOAuthProvider`
 * implements the latter, so no second parameter is needed to carry it.
 *
 * The `authProvider` option is where all of this package's OAuth support
 * actually comes from: the SDK's own transport reads a bearer token from it
 * before every request and, on a 401, drives `auth()` — refresh grant
 * included — and retries once. So the hourly rotation Google's Gmail and
 * Drive MCP servers mandate is handled per request, not by a timer this
 * package would have to run, and not by tearing the connection down and
 * building a new one with a new static header.
 *
 * @module dsh-plugins-mcp-client-oauth/transport
 */

import type { AuthProvider, FetchLike, OAuthClientProvider, Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Create an unstarted MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param fetch - optional OAuth request wrapper that binds each request to the active grant; unused by this
 *   package's own `streamable-http-oauth` case, which authorizes through `authProvider` instead.
 * @param authProvider - optional passive OAuth token and refresh callbacks, or (for `streamable-http-oauth`) this
 *   package's own `McpOAuthProvider`, which the SDK accepts directly in the same option.
 * @returns an unstarted MCP transport (stdio, Streamable HTTP, or Streamable HTTP with OAuth).
 */
export function createTransport(
  config: Config, fetch?: FetchLike, authProvider?: AuthProvider | OAuthClientProvider,
): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers },
          ...fetch === undefined ? {} : { fetch },
          ...authProvider === undefined ? {} : { authProvider, onInsufficientScope: 'throw' },
        },
      )
    case 'streamable-http-oauth':
      /* v8 ignore next 3 -- index.ts builds the provider for exactly this transport before starting the connection. */
      if (authProvider === undefined) {
        throw new Error(`mcp-client-oauth(${config.serverName}): no OAuth provider was built for this connector`)
      }
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        // `headers` stays honoured alongside OAuth: a server that wants a
        // bearer token AND a routing or tenant header is ordinary, and the
        // SDK merges its own Authorization header over this dictionary.
        { requestInit: { headers: config.headers }, authProvider, onInsufficientScope: 'throw' },
      )
  }
}
