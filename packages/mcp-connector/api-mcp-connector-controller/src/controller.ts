/**
 * Host owner of the `mcpConnectors` Remote namespace: the RPC/stream bridge a
 * browser Settings page drives to list, add, edit, remove, sign in to, and
 * sign out of MCP connectors.
 *
 * `authorize` resolves only once the whole attempt settles, which can take as
 * long as a human takes to click through a consent page, so its notices and
 * prompts never ride the RPC response. They ride `follow` instead — one
 * stream shared by every connected page, where `prompt-requested` replays as
 * a reconnect baseline, so any tab can answer a sign-in another tab started.
 *
 * Every write also publishes a `connectors-changed` frame. A settings commit
 * reaches other surfaces through the settings seam's own invalidation, but a
 * mount reconcile, a tool generation appearing, and a stored grant changing
 * do not — so a page that only watched settings would show a connector as
 * "not signed in" until something else happened to refresh it.
 *
 * @module dsh-plugins-api-mcp-connector-controller/controller
 */

import { Context } from '@deepseek-ai/cordis'
import { AuthorizationError } from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { McpConnectorInvalidError, McpConnectorNotFoundError, signInFailure } from 'dsh-plugins-mcp-connector-registry'
import type { McpConnectorDefinition, McpConnectorEntry } from 'dsh-plugins-mcp-connector-registry/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { McpConnectorFeed } from './feed.ts'
import type { McpConnectorStreamFrame, McpSignInOutcome } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `mcpConnectors` Remote namespace. */
    mcpConnectorController: McpConnectorController
  }
}

/**
 * Map a thrown refusal to the Remote failure a configuration page renders.
 *
 * The authorization seam's own `begin()` never lets a declined prompt reach
 * here — it observes the decline and settles as `{ status: 'cancelled' }`
 * instead — so only the seam's structural refusals are mapped.
 */
function failure(error: unknown): RemoteError {
  if (error instanceof McpConnectorNotFoundError) {
    return new RemoteError('mcp-connectors/not-found', error.message, {})
  }
  if (error instanceof McpConnectorInvalidError) {
    return new RemoteError('mcp-connectors/invalid', error.message, {})
  }
  if (error instanceof AuthorizationError) {
    if (error.code === 'NO_FLOW') return new RemoteError('mcp-connectors/no-flow', error.message, {})
    if (error.code === 'ALREADY_IN_FLIGHT') return new RemoteError('mcp-connectors/in-flight', error.message, {})
    return new RemoteError('mcp-connectors/rejected', error.message, {})
  }
  return new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {})
}

/** Host service backing the generated `ctx.remote.mcpConnectors` namespace. */
export class McpConnectorController extends TypertRemoteService {
  /**
   * Cordis refuses a `ctx.<service>` read from a fiber that did not declare
   * it, so every delegation below would throw at call time rather than at
   * mount time without this — and the very first call a Settings page makes
   * is `list`, so the whole page would silently render nothing.
   *
   * `authorization` is deliberately NOT listed: an OAuth connector needs it,
   * but a profile with only stdio connectors does not, and a top-level entry
   * left pending forever is fatal to the whole application in this repo's
   * boot (see ARCHITECTURE.md's "Plugin isolation"). `authorize` resolves it
   * through `ctx.get('authorization')` per call and refuses with a typed
   * `no-flow` when the seam is absent.
   */
  static inject = ['mcpConnectors']

  private readonly feed = new McpConnectorFeed()

  /** @param ctx - Host context carrying `ctx.mcpConnectors`. */
  constructor(ctx: Context) {
    super(ctx, 'mcpConnectorController', { namespace: 'mcpConnectors' })
  }

  /**
   * Every configured connector: its definition, its mount health, the tools
   * it contributes, and — for an OAuth connector — its stored authorization.
   * Never a token or a client secret.
   * @returns one entry per connector, in document order.
   */
  @Remote
  async list(): Promise<readonly McpConnectorEntry[]> {
    return await this.ctx.mcpConnectors.list()
  }

  /**
   * One connector.
   * @param id - the connector to describe.
   * @returns its entry.
   * @throws RemoteError `mcp-connectors/not-found` when nothing is configured under that id.
   */
  @Remote
  async get(id: string): Promise<McpConnectorEntry> {
    try {
      return await this.ctx.mcpConnectors.get(id)
    } catch (error) {
      throw failure(error)
    }
  }

  /**
   * Add a connector, or replace one already configured under the same id.
   * @param definition - the connector to store.
   * @throws RemoteError `mcp-connectors/invalid` when it cannot be mounted as written.
   */
  @Remote
  async put(definition: McpConnectorDefinition): Promise<void> {
    try {
      await this.ctx.mcpConnectors.put(definition)
    } catch (error) {
      throw failure(error)
    }
    this.feed.changed()
  }

  /**
   * Remove a connector and, unless asked otherwise, forget its stored
   * authorization along with it.
   *
   * Named `removeConnector` rather than the obvious `remove`: the Client
   * gateway installs every Remote method as a property of its namespace
   * *service*, and refuses any method name that shadows one of that service's
   * own members — `RemoteNamespaceService.prototype.remove` is one of them, so
   * `mcpConnectors/remove` fails the whole namespace mount at boot with
   * "conflicts with its namespace service". The reserved set is
   * `ctx`/`empty`/`invokeRemote`/`methods`/`name`/`namespace` plus that class's
   * own methods (`assertMethodAvailable`, `has`, `install`, `installDirect`,
   * `installScoped`, `remove`) — worth knowing before naming any future
   * `@Remote` method, because nothing catches it until a browser boots.
   * @param id - the connector to remove.
   * @param keepAuthorization - keep the stored OAuth grant behind; omitted forgets it.
   * @throws RemoteError `mcp-connectors/not-found` when nothing is configured under that id.
   */
  @Remote
  async removeConnector(id: string, keepAuthorization: boolean | undefined): Promise<void> {
    try {
      await this.ctx.mcpConnectors.remove(id, keepAuthorization !== true)
    } catch (error) {
      throw failure(error)
    }
    this.feed.changed()
  }

  /**
   * Store the OAuth client pair a human registered by hand.
   *
   * A write-only surface on purpose: the pair goes into the credential record
   * beside the tokens, and `list` reports only whether a client id is present
   * and what it is — never the secret.
   * @param id - the connector the pair belongs to.
   * @param clientId - the registered client id.
   * @param clientSecret - the registered client secret, where the authorization server requires one.
   * @throws RemoteError `mcp-connectors/not-found` when nothing is configured under that id.
   */
  @Remote
  async setClientCredentials(id: string, clientId: string, clientSecret: string | undefined): Promise<void> {
    try {
      await this.ctx.mcpConnectors.setClientCredentials(id, clientId, clientSecret)
    } catch (error) {
      throw failure(error)
    }
    this.feed.changed()
  }

  /**
   * Forget one connector's stored authorization, leaving its definition.
   * @param id - the connector to sign out.
   * @throws RemoteError `mcp-connectors/not-found` when nothing is configured under that id.
   */
  @Remote
  async signOut(id: string): Promise<void> {
    try {
      await this.ctx.mcpConnectors.signOut(id)
    } catch (error) {
      throw failure(error)
    }
    this.feed.changed()
  }

  /**
   * Open the shared notice/prompt stream, starting with a baseline of every
   * prompt still pending.
   * @param signal - generation cancellation.
   * @returns a baseline frame per pending prompt, then one frame per event.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<McpConnectorStreamFrame> {
    return this.feed.follow(signal)
  }

  /**
   * Answer the sign-in prompt pending for a connector, from whichever
   * connected page is showing it.
   * @param id - the connector whose prompt is being answered.
   * @param answer - the typed text or chosen option id; omit to decline.
   * @throws RemoteError `mcp-connectors/prompt-not-found` when no prompt is pending.
   */
  @Remote
  respond(id: string, answer: string | undefined): void {
    this.feed.respond(id, answer)
  }

  /**
   * Run one sign-in attempt for a connector, resolving only once it settles.
   * @param id - the connector to authorize.
   * @param signal - caller lifetime; abort withdraws the attempt like `cancelAuthorize`.
   * @returns `authorized` once the grant is committed, or `cancelled` when declined or withdrawn.
   * @throws RemoteError `mcp-connectors/no-flow` when the connector is not an
   *   OAuth connector or no authorization seam is mounted,
   *   `mcp-connectors/in-flight` when an attempt is already running, or
   *   `mcp-connectors/not-found` when nothing is configured under that id.
   */
  @Remote
  async authorize(id: string, signal: AbortSignal): Promise<McpSignInOutcome> {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new RemoteError(
        'mcp-connectors/no-flow',
        'no authorization seam is mounted in this profile, so an OAuth connector cannot be signed in',
        {},
      )
    }
    const key = parseCredentialKey(this.ctx.mcpConnectors.authorizationKey(id))
    // Withdraws this connector's pending prompt on ANY caller-lifetime
    // withdrawal, not only an explicit cancel: the seam aborts its internal
    // attempt controller from this same signal (a disconnect, not just a
    // Cancel click) and settles `cancelled` without waiting for the orphaned
    // flow to unwind, so a flow blocked inside `prompt()` would otherwise
    // leak this feed's pending entry forever.
    const withdrawOnAbort = (): void => { this.feed.withdrawPending(id) }
    signal.addEventListener('abort', withdrawOnAbort, { once: true })
    try {
      const outcome = await authorization.begin({ key, signal, interaction: this.feed.interaction(id) })
      this.feed.settled(id, outcome.status)
      return outcome
    } catch (error) {
      this.feed.settled(id, 'failed')
      throw failure(await this.explain(id, error))
    } finally {
      signal.removeEventListener('abort', withdrawOnAbort)
      this.feed.changed()
    }
  }

  /**
   * The same failure, carrying whatever diagnosis this one deserves.
   *
   * Shares `signInFailure` with the CLI so both surfaces say one thing; a page
   * that explained a failure differently from the terminal would be two
   * answers to one question.
   *
   * Returns the original error untouched when no diagnosis applies, which is
   * not a micro-optimisation: {@link failure} maps by error *type*, so
   * rewrapping an `AuthorizationError` in a plain `Error` would turn a
   * `mcp-connectors/rejected` into a `gateway/internal` and lose the code the
   * page branches on.
   *
   * @param id - the connector whose sign-in failed.
   * @param error - what the attempt threw.
   * @returns the error to map, enriched only where that changes anything.
   */
  private async explain(id: string, error: unknown): Promise<unknown> {
    try {
      const entry = await this.ctx.mcpConnectors.get(id)
      const explained = signInFailure(id, error, entry.oauth?.clientConfigured === true)
      if (explained === (error instanceof Error ? error.message : String(error))) return error
      return new Error(explained)
    } catch {
      // Reading the connector back is a courtesy, not part of the failure:
      // whatever went wrong here, the caller still deserves the original.
      return error
    }
  }

  /**
   * Withdraw the sign-in attempt running for a connector, if any
   * (idempotent) — the Cancel button's path, distinct from `authorize`'s own
   * `signal` because a request/response transport answers Cancel on a second
   * call, with no handle on the first one's signal.
   * @param id - the connector whose attempt should stop.
   */
  @Remote
  cancelAuthorize(id: string): void {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) return
    authorization.cancel(parseCredentialKey(this.ctx.mcpConnectors.authorizationKey(id)))
    this.feed.withdrawPending(id)
  }
}

export default McpConnectorController
