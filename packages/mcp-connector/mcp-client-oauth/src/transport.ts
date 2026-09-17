/**
 * Transport factory. A fork of
 * `@deepseek-ai/dsh-mcp-client`'s own `src/transport.ts` (vendor pin
 * `0d1f5000`), which this package's `src/connection.ts` fork imports in its
 * place.
 *
 * What changed, and nothing else did: the `streamable-http-oauth` case, and
 * the `authProvider` it hands the SDK. Both existing cases — the stdio child
 * with `scrubbedParentEnv()`, and the static-header Streamable HTTP URL — are
 * the vendor's own code, kept byte-for-byte so a profile that moves a server
 * from `@deepseek-ai/dsh-mcp-client` to this package sees no behaviour change
 * at all.
 *
 * The `authProvider` option is where all of the OAuth support actually comes
 * from: the SDK's own transport reads a bearer token from it before every
 * request and, on a 401, drives `auth()` — refresh grant included — and
 * retries once. So the hourly rotation Google's Gmail and Drive MCP servers
 * mandate is handled per request, not by a timer this package would have to
 * run, and not by tearing the connection down and building a new one with a
 * new static header.
 *
 * @module dsh-plugins-mcp-client-oauth/transport
 */

import type { Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { McpOAuthProvider } from './oauth/provider.ts'
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
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param oauth - The OAuth provider for a `streamable-http-oauth` server; absent for the other two.
 * @returns A connected-ready MCP Transport (stdio, Streamable HTTP, or Streamable HTTP with OAuth).
 */
export function createTransport(config: Config, oauth: McpOAuthProvider | undefined): Transport {
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
        { requestInit: { headers: config.headers } },
      )
    case 'streamable-http-oauth':
      /* v8 ignore next 3 -- index.ts builds the provider for exactly this transport before starting the connection. */
      if (oauth === undefined) {
        throw new Error(`mcp-client-oauth(${config.serverName}): no OAuth provider was built for this connector`)
      }
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        // `headers` stays honoured alongside OAuth: a server that wants a
        // bearer token AND a routing or tenant header is ordinary, and the
        // SDK merges its own Authorization header over this dictionary.
        { requestInit: { headers: config.headers }, authProvider: oauth },
      )
  }
}
