/**
 * Wire-safe connector vocabulary: what a connector *is*, and how one
 * currently stands. Types only, with no Cordis or Node import, so the Client
 * compilation face reads exactly what the Host writes.
 *
 * @module dsh-plugins-mcp-connector-registry/types
 */

import type { McpOAuthStatus } from 'dsh-plugins-mcp-client-oauth/types'

export type { McpOAuthStatus } from 'dsh-plugins-mcp-client-oauth/types'

/** Which transport a connector speaks. */
export type McpConnectorTransport = 'stdio' | 'streamable-http' | 'streamable-http-oauth'

/**
 * One connector as a human configured it.
 *
 * Deliberately one flat shape rather than a discriminated union of three, so
 * that a settings document survives a human switching a connector's transport
 * without losing the fields the other transport needs. `transport` alone
 * decides which fields are read; the rest are inert, not invalid.
 */
export interface McpConnectorDefinition {
  /**
   * Stable local namespace: the `serverName` its tools are published under
   * (`mcp__<id>__<tool>`), and — folded to lower case — the credential record
   * its OAuth grant is stored under.
   */
  id: string
  /** Human-facing name; falls back to {@link id} when blank. */
  label: string
  /** Whether this connector is mounted at all. A disabled one keeps its stored authorization. */
  enabled: boolean
  /** Which transport to speak. */
  transport: McpConnectorTransport
  /** `stdio`: executable used to start the server. */
  command?: string
  /** `stdio`: arguments passed directly, without shell interpolation. */
  args?: string[]
  /** `stdio`: extra env vars merged on top of the scrubbed ambient env. Never a secret; see {@link envFrom}. */
  env?: Record<string, string>
  /**
   * `stdio`: secret env vars, as child variable name to *credential
   * reference* — the name of a credential, never its value.
   *
   * A stdio server that authenticates with an API token needs that token in
   * its child environment, and {@link env} is the wrong place for it: this
   * definition is ordinary configuration that a settings document holds in
   * clear, and that the README promises is safe to read, print, diff, and
   * copy between machines. So the document stores the *name* and the value is
   * resolved at mount time through `ctx.credentials`, whose local provider
   * layers the inherited process environment over `$DSH_HOME/.credentials.yaml`
   * over the `.env` fallbacks. Either home works and neither is this file.
   *
   * Resolution is also what makes the value arrive at all: the subprocess
   * seam scrubs every ambient name matching `/KEY|PASSWORD|SECRET|TOKEN/i`
   * out of the child environment, so a token merely exported in the parent
   * shell never reaches the server on its own. Entries here are merged after
   * that scrub, on top of {@link env}.
   *
   * A reference that resolves to nothing fails this connector's mount, with
   * the missing name reported as its {@link McpConnectorEntry.error} — it does
   * not start the server unauthenticated to fail every tool call later.
   */
  envFrom?: Record<string, string>
  /** `stdio`: working directory for the child process. */
  cwd?: string
  /** Both HTTP transports: the MCP endpoint URL. */
  url?: string
  /** Both HTTP transports: additional headers attached to MCP requests. */
  headers?: Record<string, string>
  /**
   * `streamable-http-oauth`: the redirect URI registered with the OAuth
   * client. Omitted uses this package's default loopback URI.
   */
  redirectUri?: string
  /** `streamable-http-oauth`: scopes to request; omitted defers to the server's published `scopes_supported`. */
  scope?: string
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs?: number
  /**
   * Whether a failed first connection fails the mount. Left false by default
   * for a registry-mounted connector: one unreachable server must not stop
   * the others, and the supervisor reconnects on its own.
   */
  failOnStartupError?: boolean
}

/** How one connector's mount currently stands. */
export type McpConnectorHealth =
  /** Configured but not mounted, because `enabled` is false. */
  | 'disabled'
  /** Mounted, connected, and its tools registered. */
  | 'connected'
  /** Mounted, but the last connection attempt failed; the supervisor is retrying. */
  | 'failed'

/** One connector as a listing surface sees it: its definition, its mount, and its authorization. */
export interface McpConnectorEntry {
  /** The stored definition, verbatim. No field of it is a secret. */
  definition: McpConnectorDefinition
  /** How its mount currently stands. */
  health: McpConnectorHealth
  /** Why the mount failed, when it did. */
  error?: string
  /** Public tool names this connector currently contributes, in registration order. */
  tools: readonly string[]
  /**
   * Its stored authorization, for an OAuth connector. Absent for the two
   * transports that need none — which is a different fact from an OAuth
   * connector that is simply not signed in yet.
   */
  oauth?: McpOAuthStatus
  /**
   * The credential key an OAuth connector's `ctx.authorization` flow is
   * registered under, so a surface can drive the sign-in without deriving the
   * key itself. Absent for the two transports that need none.
   */
  authorizationKey?: string
}

/** What one `cloneAuthorization` copy did, for a surface reporting it. */
export interface McpClonedAuthorization {
  /** The connector the grant was read from. */
  source: string
  /** The connector it was written to. */
  target: string
  /** The scopes the copied token set carries, when the server named them. */
  scope?: readonly string[]
  /** Whether the target already held a grant that this copy replaced. */
  replaced: boolean
}
