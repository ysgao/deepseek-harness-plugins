/**
 * MCP client bridge with OAuth 2.0: connects to an external MCP server and
 * registers its tools on `ctx.tools` under server-qualified public names
 * (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
 * server; load multiple instances in `cordis.yml` for multiple servers, or let
 * `dsh-plugins-mcp-connector-registry` mount them from durable settings.
 *
 * **A superset of `@deepseek-ai/dsh-mcp-client`, not a competitor to it.** The
 * two transports that package supports are supported here with the same config
 * field names, the same defaults, the same reconnect policy, the same
 * `serverName` namespace reservation, the same instruction and resource
 * publication, and the same model-facing tool names — a server moved across
 * keeps working without an edit. The third transport,
 * `streamable-http-oauth`, is what this package adds, and it is genuinely
 * additive: at vendor pin `0d1f5000` `dsh-mcp-client` offers a spawned stdio
 * child with env vars or a Streamable HTTP URL with a static `headers`
 * dictionary, and neither can carry a bearer token that expires every hour.
 * Google's official Gmail (`https://gmailmcp.googleapis.com/mcp/v1`) and Drive
 * (`https://drivemcp.googleapis.com/mcp/v1`) MCP servers both publish RFC 9728
 * metadata naming `https://accounts.google.com/` as their authorization
 * server, so a static header is not an option for either.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * withdraws the authorization flow, and releases the `serverName` namespace
 * reservation. HMR hot-swaps by disposing the old instance and creating a new
 * one; identical `serverName` reproduces identical public tool names.
 *
 * @module dsh-plugins-mcp-client-oauth
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { DEFAULT_MAX_INSTRUCTION_BYTES, RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from './connection.ts'
import type { ReconnectConfig } from './connection.ts'
import { registerServerContext } from './server-context.ts'
import { McpOAuthProvider } from './oauth/provider.ts'
import { registerOAuthFlow } from './oauth/flow.ts'
import type { McpOAuthConfig } from './oauth/types.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'

export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.ts'
export { publicToolName } from './tool-bridge.ts'
export { McpOAuthProvider, McpReauthorizationRequiredError } from './oauth/provider.ts'
export {
  McpOAuthStore, assertConnectorIdUnfolded, connectorCredentialKey, foldConnectorId, grantedScopes,
  MCP_OAUTH_SCOPE, portableGrant,
} from './oauth/store.ts'
export type { McpOAuthGrantPatch } from './oauth/store.ts'
export type { McpOAuthConfig, McpOAuthGrant, McpOAuthStatus } from './oauth/types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client-oauth'

/**
 * Services required by this plugin.
 *
 * `authorization` is deliberately absent even though the OAuth transport
 * cannot sign in without it. A plugin's top-level `inject` lists only what its
 * own core purpose cannot exist without, and this plugin's core purpose is
 * bridging one server's tools — which a stdio or static-header connector does
 * with no authorization seam in the composition at all. This repo's boot
 * treats a top-level entry left pending forever as fatal to the whole
 * application, not to one feature (see ARCHITECTURE.md's "Plugin isolation"),
 * so requiring an optional seam here would turn "OAuth sign-in unavailable"
 * into "nothing starts". The flow is registered through a nested
 * `ctx.inject(['authorization'])` inside `apply()` instead.
 */
export const inject = ['tools']

/** Default timeout for individual MCP tool calls and resource requests (ms). */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/**
 * Default loopback redirect URI.
 *
 * A fixed port, not an ephemeral one, because RFC 6749 §3.1.2.3 has the
 * authorization server compare `redirect_uri` byte for byte against what the
 * client registered — so the port is part of the registration and cannot be
 * chosen when the attempt starts. 33418 is in the ephemeral range but not
 * IANA-assigned to anything; a human who needs a different one configures it
 * and registers the same value with their OAuth client.
 */
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:33418/mcp-oauth/callback'

/** Valid `serverName`, kept below the public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Live `serverName` reservations per registration scope. Agent-scoped MCP
 * servers may reuse a namespace in another Agent, while global instances and
 * duplicates inside one Agent remain mutually exclusive.
 *
 * Separate from `@deepseek-ai/dsh-mcp-client`'s own map, which is module-
 * private to that package. A composition running both plugins with one
 * `serverName` therefore reaches the tool registry rather than this guard —
 * where `ctx.tools.register` refuses the duplicate public name and the second
 * instance's sync rolls back with a logged error, which is the same outcome
 * one step later.
 */
const activeServerNames = new WeakMap<object, Set<string>>()

// ---- Config ----

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum UTF-8 bytes of attributed server instructions (default 32768). */
  maxInstructionBytes?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP with static headers. */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum UTF-8 bytes of attributed server instructions (default 32768). */
  maxInstructionBytes?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/**
 * Config for connecting to an MCP server over Streamable HTTP authorized by
 * OAuth 2.0, with the access token refreshed automatically for as long as the
 * refresh grant lasts.
 */
export interface StreamableHttpOAuthConfig {
  /** Selects Streamable HTTP transport with an OAuth 2.0 authorization-code grant. */
  transport: 'streamable-http-oauth'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live instances. Also folds down to the credential key this
   * connector's grant is stored under.
   */
  serverName: string
  /** MCP endpoint URL — the protected resource the token authorizes against. */
  url: string
  /** Additional headers attached to MCP requests, alongside the bearer token. */
  headers: Record<string, string>
  /** Human-facing name of what is being authorized, shown by any sign-in surface. */
  label: string
  /** The OAuth client half. */
  oauth: McpOAuthConfig
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum UTF-8 bytes of attributed server instructions (default 32768). */
  maxInstructionBytes?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Configuration for one stdio, Streamable HTTP, or OAuth Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig | StreamableHttpOAuthConfig

type StdioConfigInput = Omit<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
type StreamableHttpConfigInput = Omit<StreamableHttpConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StreamableHttpConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
type StreamableHttpOAuthConfigInput =
  Omit<StreamableHttpOAuthConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError' | 'label' | 'oauth'>
  & Partial<Pick<StreamableHttpOAuthConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError' | 'label'>>
  & { oauth?: Partial<McpOAuthConfig> }
type ConfigInput = StdioConfigInput | StreamableHttpConfigInput | StreamableHttpOAuthConfigInput

const Reconnect: z<ReconnectConfig> = z.object({
  enabled: z.boolean().default(RECONNECT_DEFAULTS.enabled),
  initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts),
})

const OAuth: z<McpOAuthConfig> = z.object({
  clientId: z.string(),
  clientSecret: z.string().role('secret'),
  redirectUri: z.string().default(DEFAULT_REDIRECT_URI),
  scope: z.string(),
  clientName: z.string(),
})

export const Config = z.union([
  z.object({
    transport: z.const('stdio'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    maxInstructionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INSTRUCTION_BYTES),
    reconnect: Reconnect,
  }),
  z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    maxInstructionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INSTRUCTION_BYTES),
    reconnect: Reconnect,
  }),
  z.object({
    transport: z.const('streamable-http-oauth'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    label: z.string().default(''),
    oauth: OAuth,
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    maxInstructionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INSTRUCTION_BYTES),
    reconnect: Reconnect,
  }),
]) as unknown as z<ConfigInput, Config>

// ---- Plugin apply ----

/**
 * Connect one MCP server and publish its initial tool generation before activation.
 * This entry remains explicitly `async`: Cordis treats a prototype-bearing
 * ordinary function as a constructor, whose returned Promise is not startup work.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved transport and server namespace configuration.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Fail loud at load: reconnect misconfiguration (including programmatic
  // construction that bypassed Schemastery) rejects THIS instance before any
  // effect registers.
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client-oauth(${config.serverName}): reconnect`)

  // Reserve the namespace next: a duplicate `serverName` fails THIS instance
  // at load with an actionable error and leaves the earlier instance intact.
  ctx.effect(() => {
    const owner = scopeOf(ctx) ?? ctx.root
    let names = activeServerNames.get(owner)
    if (!names) {
      names = new Set()
      activeServerNames.set(owner, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(
        `mcp-client-oauth: serverName "${config.serverName}" is already in use by another instance — pick a unique serverName`,
      )
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'mcp-client-oauth.serverName')

  // Built before the connection so the very first request already carries a
  // stored bearer token: a connector authorized in an earlier session must
  // reconnect on boot without anyone signing in again.
  const oauth = config.transport === 'streamable-http-oauth'
    ? new McpOAuthProvider(ctx, config.serverName, config.oauth)
    : undefined
  if (oauth !== undefined && config.transport === 'streamable-http-oauth') {
    const { serverName, url } = config
    const label = config.label === '' ? serverName : config.label
    // Nested, not a top-level `inject` — see this module's `inject` doc.
    // A composition with no authorization seam keeps every already-stored
    // token working, including refreshes; only signing in afresh is absent.
    void ctx.inject(['authorization'], (scope) => {
      scope.effect(
        () => registerOAuthFlow(scope, serverName, label, url, oauth),
        'mcp-client-oauth.authorizationFlow',
      )
    })
  }

  // The supervisor owns the client/transport generations, the reconnect
  // loop, and the live tool registrations; disposal stops reconnection,
  // quiesces in-flight work, and unregisters the current generation.
  const connection = startConnection(ctx, config, reconnect, oauth)
  registerServerContext(ctx, config.serverName, connection)
  let stopping: Promise<void> | undefined
  const dispose = (): Promise<void> => stopping ??= connection.dispose()
  // Cordis announces unload before awaiting an unfinished apply(). Closing
  // the transport here releases startup requests that are still awaiting a reply.
  // oxlint-disable-next-line typescript/no-misused-promises -- Cordis contains observer failures; the effect also awaits this promise.
  ctx.on('internal/plugin', (fiber) => {
    if (fiber !== ctx.fiber || fiber.uid !== null) return
    return dispose()
  }, { global: true })
  ctx.effect(() => dispose, 'mcp-client-oauth.connection')

  // Block plugin activation on the initial connection + tool discovery so
  // Cordis consumers observe the tools immediately after the fiber activates.
  // When failOnStartupError is true, a failed initial attempt rejects the
  // fiber (Cordis rolls it back); otherwise the error is logged and the
  // supervisor enters its reconnect loop.
  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(
      `mcp-client-oauth(${config.serverName}): initial connection or tool synchronization failed`,
      { cause: outcome.error },
    )
  }
}
