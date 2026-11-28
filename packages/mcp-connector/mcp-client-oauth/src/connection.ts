/**
 * Connection supervisor: owns the MCP client/transport generations for one
 * plugin instance, keeps the harness tool registry in sync with the live
 * generation, and — when the connection drops, or the server no longer knows
 * its Streamable HTTP session — restarts the configured server with bounded
 * exponential backoff.
 *
 * One outage shares one attempt budget (`maxAttempts` consecutive failed
 * attempts, delays doubling from `initialDelayMs` up to `maxDelayMs`). A
 * connection that stays up past the stability window closes the outage, so
 * the next disconnect starts a fresh budget while a crash-looping server —
 * even one whose connects briefly succeed — still exhausts the cap instead of
 * restarting forever. Exhaustion unregisters the server's tools and stops;
 * disposal (including HMR) is the only way back from that state. A failure
 * that needs a human to sign in again (see fork point 3) stops the same way,
 * without spending the budget on retries that cannot succeed.
 *
 * A fork of `@deepseek-ai/dsh-mcp-client`'s own `src/connection.ts` (vendor
 * pin `841f76d3`). The outage-budget reconnect loop below is still the
 * vendor's, unchanged, because none of it is what OAuth touches. What
 * differs from the original is exactly three things, each marked where it
 * occurs:
 *
 * 1. `createTransport` comes from this package's own `./transport.ts` and
 *    takes the OAuth provider as its `authProvider` argument;
 * 2. `syncTools` and its two types come from this package's own
 *    `./tool-bridge.ts`, which a Host package can actually import at runtime
 *    (see that file's own doc comment);
 * 3. `startConnection` takes the OAuth provider, threads it to the transport
 *    factory, and — new at this pin — treats `McpReauthorizationRequiredError`
 *    as a reason to stop the automatic reconnect loop rather than keep
 *    retrying against a login wall.
 *
 * At vendor pin `841f76d3` the vendor's own `connection.ts` was rewritten
 * around a handful of new internal modules (`generation.ts`, `status.ts`,
 * `diagnostic.ts`, `deadline.ts`, `credentials.ts`/`templates.ts`,
 * `tool-loading.ts`) that are not part of the four files this package is
 * recorded against in `scripts/replacement-parity.json`, and are not
 * reachable from a Host package anyway (none of them are re-exported from
 * the package entry — see `tool-bridge.ts`'s own doc comment on the same
 * constraint). Three of that rewrite's real, user-visible behaviour changes
 * are still ported here, each in the form this file's own simpler generation
 * tracking can carry without adopting that whole architecture:
 *
 * - **Session-expiry reconnect.** A Streamable HTTP server can refuse a
 *   request because it no longer recognises the session (HTTP 404, or a 400
 *   whose body says so) without ever closing the transport itself, which
 *   this file's close-driven reconnect previously had no way to notice. The
 *   vendor's new version keeps the expired generation open and answers only
 *   the refused request with a dedicated error while a fresh generation
 *   connects underneath it (`McpGeneration`/`McpSessionRefused`). This fork
 *   folds the simpler half of that into the existing close-driven path
 *   instead: a detected session rejection closes the current generation and
 *   schedules a reconnect through the same `generationDown` path an
 *   ordinary `onclose` already used. A call already in flight when this
 *   happens still fails — as an ordinary disconnect, not a distinguished
 *   "session expired, retry me" error — which is a real, bounded
 *   simplification from the vendor's per-request-aware version.
 * - **Typed, importable diagnostics.** `McpLocalError`/`McpToolError` are
 *   genuinely new exports from the package entry (not vendor-internal), so
 *   this fork imports and uses them the same way the vendor's own code does,
 *   in the resource-request path below.
 * - **Resource-capability guard.** `resources.request` no longer calls
 *   `listResources`/`listResourceTemplates` on a server that never
 *   advertised the `resources` capability — the SDK answers such a call with
 *   the same empty page it would return anyway, but also writes a
 *   `console.debug` line to stdout, which the ACP profile reserves for
 *   JSON-RPC.
 *
 * Not ported: on-demand tool loading, credential-template config expansion
 * and secret redaction, the configurable `startupTimeoutMs` startup budget,
 * and the `McpConnectionStatusHandle` status-cell surface a UI could read —
 * all four depend on the vendor-internal modules named above, which would
 * mean forking files beyond the four this package is recorded against.
 * `closeTimeoutMs` (the one new config field this file's own logic actually
 * uses — see `index.ts`) is ported; the rest are a deliberate, reported
 * scope boundary, not a silent omission.
 *
 * Diagnostic prefixes say `mcp-client-oauth` rather than `mcp-client` so a log
 * line names the plugin that actually emitted it.
 *
 * @module dsh-plugins-mcp-client-oauth/connection
 */

import { Client, SdkErrorCode, SdkHttpError, type Transport } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import { assertNever, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { McpLocalError, McpToolError } from '@deepseek-ai/dsh-mcp-client'
import type { ServerContext } from './server-context.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
// Fork point 1 + 2: this package's own transport factory and tool bridge.
import { createTransport } from './transport.ts'
import { McpToolRegistrationError, syncTools } from './tool-bridge.ts'
import type { ToolBridgeOptions, ToolDisposers } from './tool-bridge.ts'
import { McpReauthorizationRequiredError } from './oauth/provider.ts'
import type { McpOAuthProvider } from './oauth/provider.ts'
import type { Config } from './index.ts'

/** Automatic reconnect policy for one MCP server connection. */
export interface ReconnectConfig {
  /** Reconnect automatically after a lost connection (default true). */
  enabled?: boolean
  /** First reconnect delay in milliseconds; doubles per consecutive failed attempt (default 500). */
  initialDelayMs?: number
  /** Backoff ceiling in milliseconds; also the uptime after which the attempt budget resets (default 30000). */
  maxDelayMs?: number
  /** Consecutive failed attempts per outage before giving up for good (default 10). */
  maxAttempts?: number
}

/** Defaults shared by the Config schema and {@link resolveReconnectPolicy}. */
export const RECONNECT_DEFAULTS: Required<ReconnectConfig> = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
})

/** Default UTF-8 byte limit for attributed server instructions. */
export const DEFAULT_MAX_INSTRUCTION_BYTES = 32_768

/**
 * Default budget for transport closure and local cleanup (ms). Matches the vendor's own
 * `DEFAULT_CLOSE_TIMEOUT_MS` (`config.ts`, vendor pin `841f76d3`), which replaced that package's
 * previously hardcoded `GENERATION_CLOSE_TIMEOUT_MS` with the same numeric default as a configurable
 * field — see `closeTimeoutMs` on each transport's config in `index.ts`.
 */
export const DEFAULT_CLOSE_TIMEOUT_MS = 5_000

/** Fully resolved reconnect policy captured at plugin load. */
export type ResolvedReconnectPolicy = Readonly<Required<ReconnectConfig>>

/**
 * The one explicit resolve step from raw reconnect config to the policy the
 * supervisor runs. Programmatic construction may bypass Schemastery
 * normalization, so every default and bound is re-judged here — misconfiguration
 * fails the plugin instance at load.
 *
 * @param config - Raw `reconnect` config; omission uses the defaults.
 * @param path - Diagnostic prefix naming the config location in thrown messages.
 * @returns The frozen resolved policy.
 */
export function resolveReconnectPolicy(config: ReconnectConfig | undefined, path: string): ResolvedReconnectPolicy {
  if (config !== undefined) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(`${path}.${key} is not a reconnect option`)
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts
  /* jscpd:ignore-start — domain-specific delay validation parallels llm retry-policy; not extractable */
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`${path}.maxAttempts must be a positive integer`)
  }
  /* jscpd:ignore-end */
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts })
}

/** Result from the initial connection attempt, for startup-await semantics. */
export interface ConnectionOutcome {
  /** If the initial connection or tool sync failed, the error; otherwise absent. */
  error?: unknown
}

/** Handle for one plugin instance's supervised connection. */
export interface ConnectionHandle extends ServerContext {
  /**
   * Settles when the first connection attempt completes (success or failure).
   * The supervisor enters its reconnect loop regardless; the caller decides
   * whether a failed startup is fatal via `failOnStartupError`.
   */
  ready: Promise<ConnectionOutcome>
  /**
   * Stop reconnection, close the negotiating transport or live client, wait
   * for the in-flight attempt and queued tool syncs to quiesce, then
   * unregister every tool this server still owns.
   */
  dispose(): Promise<void>
}

/**
 * Wording servers put in an HTTP 400 body when they no longer know the session, ported from the
 * vendor's own `diagnostic.ts` (not re-exported — see this module's own doc comment).
 */
const SESSION_REJECTION = /session|not initialized/i

/**
 * Whether the server rejected a request because it no longer knows the Streamable HTTP session.
 * HTTP 404 is the specified answer; HTTP 400 counts only when its body names the session, because
 * servers also answer malformed requests with 400.
 * @param error - SDK error from a connection that holds a session id.
 * @returns true when later requests can succeed only after a new `initialize`.
 */
function sessionRejected(error: unknown): boolean {
  if (!(error instanceof SdkHttpError) || error.code !== SdkErrorCode.ClientHttpNotImplemented) return false
  if (error.status === 404) return true
  const body = error.data.text
  return error.status === 400 && typeof body === 'string' && SESSION_REJECTION.test(body)
}

/**
 * Start the supervised connection for one MCP server and keep it alive per
 * the reconnect policy.
 *
 * @param ctx - Cordis context providing the `tools` registry and logger.
 * @param config - Resolved plugin config selecting the transport and server identity.
 * @param policy - Resolved reconnect policy from {@link resolveReconnectPolicy}.
 * @param oauth - Fork point 3: the OAuth provider for a `streamable-http-oauth`
 *   server, `undefined` for the two transports the vendor already supports. One
 *   provider serves every generation on purpose — it holds the persisted grant,
 *   so a reconnect reuses the same tokens rather than re-authorizing.
 * @returns Handle with a `ready` promise for startup-await and a `dispose` for teardown.
 */
export function startConnection(
  ctx: Context,
  config: Config,
  policy: ResolvedReconnectPolicy,
  oauth: McpOAuthProvider | undefined,
): ConnectionHandle {
  const label = `mcp-client-oauth(${config.serverName})`
  const incompleteDisposalMessage = `${label}: transport closure could not be confirmed during disposal — server shutdown may be incomplete`
  const closeTimeoutMs = config.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS
  const opts: ToolBridgeOptions = {
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
  }

  let disposed = false
  const maxInstructionBytes = config.maxInstructionBytes ?? DEFAULT_MAX_INSTRUCTION_BYTES
  let serverInstructions = ''
  /** Current generation: the connecting or connected client; undefined during backoff waits and after final failure. */
  let client: Client | undefined
  /** Transport-aware close operation paired with {@link client}. */
  let closeClient: (() => Promise<boolean>) | undefined
  /** Live tool registrations owned by this server; only {@link enqueueSync} and dispose swap it. */
  let disposers: ToolDisposers = new Map()
  let reconnectTimer: NodeJS.Timeout | undefined
  /** Consecutive failed connection attempts within the current outage. */
  let failedAttempts = 0
  /** When the current generation finished connect + initial sync; undefined while down. */
  let connectedAt: number | undefined
  /** The real error from the first connection attempt, for startup-await diagnostics. */
  let firstAttemptError: unknown

  /** A generation may act only while it is the current one on a live plugin. */
  const isCurrent = (generation: Client): boolean => !disposed && client === generation

  /**
   * Serializes every syncTools call — initial syncs and notification re-syncs
   * across all generations — so two syncs can never interleave their
   * dispose-previous/register-next swap (which would double-dispose one
   * generation and leak another).
   */
  let syncChain: Promise<void> = Promise.resolve()
  function enqueueSync(generation: Client): Promise<void> {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return
      disposers = await syncTools(generation, ctx, opts, disposers)
    })
    // The chain tail must survive a failed sync; the enqueuing caller owns reporting.
    syncChain = run.catch(() => {})
    return run
  }

  /** One disconnect decision per generation: the isCurrent guard makes racing close/error signals idempotent. */
  function generationDown(generation: Client): void {
    if (!isCurrent(generation)) return
    client = undefined
    closeClient = undefined
    scheduleReconnect()
  }

  /** Decide retry ownership after a failed connection's close barrier settles. */
  function settleFailedGeneration(generation: Client, quiesced: boolean): void {
    if (!isCurrent(generation)) return
    if (!quiesced) {
      client = undefined
      closeClient = undefined
      ctx.logger.error(`${label}: failed generation could not confirm transport closure — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`)
      return
    }
    generationDown(generation)
  }

  /** Wait for the transport-owned close signal without letting a broken transport wedge teardown forever. */
  function waitForClose(closed: Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { resolve(false) }, closeTimeoutMs)
      timeout.unref()
      void closed.then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }

  function scheduleReconnect(): void {
    const lostEstablishedConnection = connectedAt !== undefined
    if (!policy.enabled) {
      const message = lostEstablishedConnection
        ? 'connection lost and reconnect is disabled — registered tools will fail until an HMR reload or Host restart'
        : 'connection failed and reconnect is disabled — no tools were registered; reload the plugin or restart the Host to connect'
      ctx.logger.error(`${label}: ${message}`)
      return
    }
    // A connection that stayed up past the stability window (= maxDelayMs, the
    // longest backoff spacing) ended the previous outage: start a fresh budget.
    if (connectedAt !== undefined && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0
    connectedAt = undefined
    failedAttempts += 1
    if (failedAttempts > policy.maxAttempts) {
      // Enqueue the give-up disposal so it cannot race an in-flight sync's
      // phase-2 swap (which checks isCurrent inside the queue).
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
        serverInstructions = ''
      })
      ctx.logger.error(`${label}: giving up after ${policy.maxAttempts} consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect`)
      return
    }
    const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1))
    const action = lostEstablishedConnection ? 'connection lost; reconnecting' : 'connection failed; retrying'
    ctx.logger.warn(`${label}: ${action} in ${delayMs}ms (attempt ${failedAttempts}/${policy.maxAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      settling = connectGeneration()
    }, delayMs)
    // An armed reconnect timer must never hold the process open on its own.
    reconnectTimer.unref()
  }

  /**
   * One connection attempt: fresh transport + client (the MCP SDK binds a
   * Protocol to one transport for life), connect, then queue the initial tool
   * sync. Every failure funnels through {@link generationDown} or the
   * reauthorization short-circuit below; success arms the onclose- and
   * onerror-driven disconnect paths. Never rejects.
   */
  async function connectGeneration(): Promise<void> {
    const generation = new Client(
      { name: 'dsh-mcp-client', version: '0.0.1' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        listChanged: {
          tools: {
            autoRefresh: false,
            debounceMs: 0,
            onChanged: () => { void refreshTools() },
          },
        },
      },
    )
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    let attemptSettled = false
    let closeObserved = false
    let transport: Transport | undefined
    const hasClosed = (): boolean => closeObserved
    client = generation
    closeClient = closeGeneration
    generation.onclose = () => {
      closeObserved = true
      closed.resolve()
      // A failed connect owns its close barrier in the catch path below. An
      // established generation can transition down directly from this signal.
      if (attemptSettled) generationDown(generation)
    }
    // New at vendor pin `841f76d3` (ported in simplified form — see this
    // module's own doc comment): a Streamable HTTP server can refuse a
    // request because it no longer knows the session without ever closing
    // the transport, which `onclose` alone would never notice.
    generation.onerror = (error) => {
      if (!isCurrent(generation) || connectedAt === undefined || !sessionRejected(error)) return
      ctx.logger.warn(`${label}: server no longer knows the Streamable HTTP session; reconnecting`)
      settling = (async () => {
        const quiesced = await closeGeneration()
        attemptSettled = true
        settleFailedGeneration(generation, quiesced)
      })()
    }
    /** Unattached probes close through their transport; attached clients must also report transport closure. */
    async function closeGeneration(): Promise<boolean> {
      const attached = generation.transport !== undefined
      try {
        await (attached ? generation.close() : transport?.close())
      } catch (_error) {
        if (!attached) return hasClosed()
      }
      return !attached || hasClosed() || await waitForClose(closed.promise)
    }
    async function refreshTools(): Promise<void> {
      if (!isCurrent(generation)) return
      ctx.logger.info(`${label}: tool list changed, re-syncing`)
      try {
        await enqueueSync(generation)
      } catch (error) {
        // New at vendor pin `841f76d3`: a registry-namespace conflict always
        // throws now (see `tool-bridge.ts`), and leaving the connection up
        // with a stale or empty tool set would otherwise be permanent —
        // closing and reconnecting at least gives a transient foreign
        // registration a chance to have gone away by the next attempt.
        if (error instanceof McpToolRegistrationError) {
          if (!isCurrent(generation)) return
          const quiesced = await closeGeneration()
          settleFailedGeneration(generation, quiesced)
        } else if (!disposed) {
          ctx.logger.error(`${label}: tool re-sync failed: ${String(error)}`)
        }
      }
    }
    let instructions: string
    try {
      // Fork point 1: the OAuth provider reaches the SDK transport here, as
      // the `authProvider` parameter `createTransport` now shares with the
      // vendor's own native OAuth passthrough (see `transport.ts`).
      transport = createTransport(config, undefined, oauth)
      await generation.connect(transport)
      if (hasClosed()) {
        attemptSettled = true
        generationDown(generation)
        return
      }
      if (!isCurrent(generation)) {
        if (!await closeGeneration()) ctx.logger.error(incompleteDisposalMessage)
        return
      }
      const serverText = generation.getInstructions()?.trimEnd() ?? ''
      instructions = serverText ? `### MCP server: ${config.serverName}\n\n${serverText}` : ''
      if (Buffer.byteLength(instructions) > maxInstructionBytes) {
        throw new McpLocalError(`${label}: server instructions exceed maxInstructionBytes (${maxInstructionBytes})`, 'MCP_INSTRUCTIONS_TOO_LARGE')
      }
      await enqueueSync(generation)
    } catch (error) {
      if (firstAttemptError === undefined) firstAttemptError = error
      // Disposal clears current ownership before it closes the generation, so
      // only a live supervisor reports an attempt failure.
      if (isCurrent(generation)) ctx.logger.warn(`${label}: connection attempt failed: ${String(error)}`)
      const quiesced = await closeGeneration()
      attemptSettled = true
      // Fork point 3: a stored grant that can no longer be renewed without a
      // human (our own `McpOAuthProvider` throws this when the SDK asks to
      // redirect or state() outside a running `ctx.authorization` attempt)
      // cannot be fixed by retrying — the vendor's new `waiting-authorization`
      // status exists for exactly this, which this package does not adopt
      // (see this module's own doc comment); stopping the reconnect loop
      // here is the bounded equivalent available without it.
      if (error instanceof McpReauthorizationRequiredError) {
        if (isCurrent(generation)) {
          client = undefined
          closeClient = undefined
          ctx.logger.error(`${label}: ${error.message}`)
        }
        return
      }
      settleFailedGeneration(generation, quiesced)
      return
    }
    attemptSettled = true
    if (hasClosed()) {
      generationDown(generation)
      return
    }
    if (!isCurrent(generation)) return
    serverInstructions = instructions
    connectedAt = Date.now()
    if (failedAttempts > 0) ctx.logger.info(`${label}: reconnected and re-synced tools (attempt ${failedAttempts}/${policy.maxAttempts})`)
  }

  /** The in-flight (or last settled) connection attempt; dispose awaits it for quiescence. */
  let settling = connectGeneration()

  // The ready promise settles when the first attempt finishes (regardless of
  // success). If the first attempt fails and reconnect is enabled, the
  // supervisor is already scheduling a retry — ready just reports the outcome.
  const ready: Promise<ConnectionOutcome> = settling.then(() => {
    // After settling: if client is set the initial connect+sync succeeded.
    // If not, the supervisor either scheduled a retry (error logged) or gave
    // up (error logged). Either way the outcome is reported with the real error.
    // Note: settling.then() is a microtask; stdio onclose is a macrotask — so
    // a server that crashes AFTER a successful initial sync cannot flip client
    // to undefined before this continuation runs.
    if (client !== undefined) return {}
    /* v8 ignore next -- defensive: firstAttemptError is always set when connect/sync fails */
    return { error: firstAttemptError ?? new Error(`${label}: initial connection failed`) }
  })

  return {
    ready,
    instructions: () => serverInstructions,
    resources: {
      async request(request, exec): Promise<JsonValue> {
        const generation = client
        if (!generation || connectedAt === undefined) {
          throw new McpToolError(`${label}: server is disconnected`, 'MCP_SERVER_UNAVAILABLE')
        }
        const options = { signal: exec.signal, timeout: config.toolCallTimeoutMs }
        // New at vendor pin `841f76d3`: the SDK answers an unadvertised capability with the same
        // empty page, but also writes a `console.debug` line to stdout, which the ACP profile
        // reserves for JSON-RPC.
        const listable = generation.getServerCapabilities()?.resources !== undefined
        switch (request.method) {
          case 'resources/list':
            return listable
              ? await generation.listResources(
                request.cursor === undefined ? undefined : { cursor: request.cursor }, options,
              ) as JsonValue
              : { resources: [] }
          case 'resources/templates/list':
            return listable
              ? await generation.listResourceTemplates(
                request.cursor === undefined ? undefined : { cursor: request.cursor }, options,
              ) as JsonValue
              : { resourceTemplates: [] }
          case 'resources/read':
            return await generation.readResource({ uri: request.uri }, options) as JsonValue
          /* v8 ignore next 2 -- resource requests are the closed, typed tool operation union */
          default:
            return assertNever(request)
        }
      },
    },
    async dispose(): Promise<void> {
      disposed = true
      serverInstructions = ''
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      const close = closeClient
      client = undefined
      closeClient = undefined
      if (close !== undefined && !await close()) {
        ctx.logger.error(incompleteDisposalMessage)
      }
      // Quiesce, don't just request it: the in-flight attempt enqueues its
      // sync before settling, so awaiting both leaves `disposers` final.
      await settling
      await syncChain
      for (const dispose of disposers.values()) dispose()
      disposers = new Map()
    },
  }
}
