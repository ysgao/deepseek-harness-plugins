/**
 * Client-side face of the `mcpConnectors` Remote namespace: drives the Host
 * controller and projects its state for the Settings page.
 *
 * Registered as `ctx.mcpConnectorsClient`, not `ctx.mcpConnectors` — that
 * name belongs to the Host registry, and a Client-side service reusing it
 * would read as the same thing across the wire when it is a different object
 * with a different shape. The same reason keeps this off
 * `ctx.authorization`: `dsh-plugins-client-ui-settings-anthropic-
 * subscription` already provides a Client service under that name, and two
 * providers of one name is a hard Cordis conflict — so a profile carrying
 * both bundles would fail to boot if this one squatted there.
 *
 * @module dsh-plugins-client-ui-settings-mcp-connector/runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthorizationNotice } from '@deepseek-ai/dsh-authorization/types'
import type {
  McpConnectorDefinition, McpConnectorEntry, McpConnectorStreamFrame, WireMcpPrompt,
} from 'dsh-plugins-api-mcp-connector-controller/types'
// Type-only: pulls the generated ctx.remote.mcpConnectors namespace merge —
// mounted at runtime by the independent dsh-plugins-client-remotes-mcp-
// connector plugin, not by this package.
import type {} from 'dsh-plugins-api-mcp-connector-controller/remote'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client-side face of the MCP connector registry; see {@link IMcpConnectors}. */
    mcpConnectorsClient: IMcpConnectors
  }
}

/** Live state of one connector's sign-in attempt. */
export interface McpSignInState {
  /** Whether an attempt is running right now, in this tab or another. */
  readonly inFlight: boolean
  /** Notices accumulated since the attempt began; cleared when it settles. */
  readonly notices: readonly AuthorizationNotice[]
  /** The one prompt currently awaiting an answer, if any. */
  readonly pendingPrompt: WireMcpPrompt | undefined
}

/** The page's whole state: the connector list plus per-connector sign-in state. */
export interface McpConnectorsState {
  /** Every configured connector, in document order. */
  entries: readonly McpConnectorEntry[]
  /** Load state of {@link entries}. */
  status: 'idle' | 'loading' | 'loaded' | 'error'
  /** Why the last load failed. */
  error?: string
  /** Live sign-in state keyed by connector id; absent means idle. */
  byId: Record<string, McpSignInState>
}

/**
 * The state a connector carries before any sign-in has run for it. Exported
 * so a consumer reading `byId[id]` supplies this rather than treating the
 * key's absence as "nothing to render" — a connector nothing has pushed a
 * frame for is exactly the case the page most needs to draw.
 */
export const IDLE_SIGN_IN: McpSignInState = { inFlight: false, notices: [], pendingPrompt: undefined }

/** The connector-registry face injected as `ctx.mcpConnectorsClient`. */
export interface IMcpConnectors {
  /** The connector list and live per-connector sign-in state. */
  readonly state: SnapshotStore<McpConnectorsState>
  /** (Re)load the connector list from the Host. */
  refresh(): Promise<void>
  /** Add a connector, or replace one already configured under the same id. */
  put(definition: McpConnectorDefinition): Promise<void>
  /** Remove a connector and forget its stored authorization. */
  remove(id: string): Promise<void>
  /** Store the OAuth client pair a human registered by hand. */
  setClientCredentials(id: string, clientId: string, clientSecret?: string): Promise<void>
  /** Forget a connector's stored authorization, leaving its definition. */
  signOut(id: string): Promise<void>
  /**
   * Start a sign-in attempt. Resolves once it settles — a human clicking
   * through a consent page can take minutes — with its notices and prompts
   * arriving as pushed state on {@link state} in the meantime.
   */
  signIn(id: string): Promise<void>
  /** Withdraw the sign-in attempt running for a connector, if any. */
  cancelSignIn(id: string): Promise<void>
  /** Answer the sign-in prompt pending for a connector. */
  respond(id: string, answer: string): Promise<void>
  /** Decline the sign-in prompt pending for a connector. */
  decline(id: string): Promise<void>
}

/** The generated `ctx.remote.mcpConnectors` namespace's Client method shapes this runtime drives. */
export type McpConnectorRemote = TypertClientRemote['mcpConnectors']

/**
 * A rejected RPC's message, for a surface that shows the reason next to the
 * control the human just used. The Remote layer answers `{ ok: false }`
 * rather than throwing for a declared failure, so both shapes are folded
 * into one thrown `Error` here and the page has a single failure path.
 */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message?: string } }): T {
  if (result.ok) return result.value
  throw new Error(result.error.message ?? 'the request was refused')
}

/** Real client-side connector-registry layer, backing `ctx.mcpConnectorsClient`. */
export class McpConnectorRuntime extends Service implements IMcpConnectors {
  readonly state: SnapshotStore<McpConnectorsState>

  /**
   * @param ctx - client root context; owns the follow-stream's lifetime.
   * @param remote - the generated `ctx.remote.mcpConnectors` namespace.
   */
  constructor(ctx: Context, private readonly remote: McpConnectorRemote) {
    super(ctx, 'mcpConnectorsClient')
    this.state = createSnapshotStore<McpConnectorsState>({ entries: [], status: 'idle', byId: {} })
    const controller = new AbortController()
    ctx.effect(() => {
      void this.pump(controller.signal)
      return () => { controller.abort() }
    }, 'ui-settings-mcp-connector: connector follow stream')
  }

  /** @inheritdoc */
  async refresh(): Promise<void> {
    this.state.update((draft) => { draft.status = 'loading' })
    try {
      const result = await this.remote.list()
      if (!result.ok) {
        this.state.update((draft) => {
          draft.status = 'error'
          draft.error = result.error.message ?? 'loading the connector list failed'
        })
        return
      }
      this.state.update((draft) => {
        draft.entries = result.value
        draft.status = 'loaded'
        delete draft.error
      })
    } catch (error) {
      this.state.update((draft) => {
        draft.status = 'error'
        draft.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** @inheritdoc */
  async put(definition: McpConnectorDefinition): Promise<void> {
    unwrap(await this.remote.put(definition))
    await this.refresh()
  }

  /** @inheritdoc */
  async remove(id: string): Promise<void> {
    unwrap(await this.remote.remove(id, undefined))
    await this.refresh()
  }

  /** @inheritdoc */
  async setClientCredentials(id: string, clientId: string, clientSecret?: string): Promise<void> {
    unwrap(await this.remote.setClientCredentials(id, clientId, clientSecret))
    await this.refresh()
  }

  /** @inheritdoc */
  async signOut(id: string): Promise<void> {
    unwrap(await this.remote.signOut(id))
    await this.refresh()
  }

  /** @inheritdoc */
  async signIn(id: string): Promise<void> {
    try {
      unwrap(await this.remote.authorize(id))
    } finally {
      await this.refresh()
    }
  }

  /** @inheritdoc */
  async cancelSignIn(id: string): Promise<void> {
    unwrap(await this.remote.cancelAuthorize(id))
  }

  /** @inheritdoc */
  async respond(id: string, answer: string): Promise<void> {
    unwrap(await this.remote.respond(id, answer))
  }

  /** @inheritdoc */
  async decline(id: string): Promise<void> {
    unwrap(await this.remote.respond(id, undefined))
  }

  /** Drain the shared `follow` stream into per-connector live state until aborted. */
  private async pump(signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of this.remote.follow(signal)) this.applyFrame(frame)
      /* v8 ignore next 3 -- abort is the only production exit; nothing else closes the shared stream. */
    } catch (error) {
      if (!signal.aborted) throw error
    }
  }

  private applyFrame(frame: McpConnectorStreamFrame): void {
    if (frame.type === 'connectors-changed') {
      void this.refresh()
      return
    }
    this.state.update((draft) => {
      const existing = draft.byId[frame.id] ?? IDLE_SIGN_IN
      switch (frame.type) {
        case 'notice':
          draft.byId[frame.id] = { ...existing, inFlight: true, notices: [...existing.notices, frame.notice] }
          return
        case 'prompt-requested':
          draft.byId[frame.id] = { ...existing, inFlight: true, pendingPrompt: frame.prompt }
          return
        case 'prompt-resolved':
          draft.byId[frame.id] = { ...existing, pendingPrompt: undefined }
          return
        case 'settled':
          draft.byId[frame.id] = IDLE_SIGN_IN
      }
    })
  }
}
