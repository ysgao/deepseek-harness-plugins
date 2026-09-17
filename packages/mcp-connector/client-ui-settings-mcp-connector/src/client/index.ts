/**
 * MCP connectors settings plugin, browser half: registers one additive
 * `settings.section` entry.
 *
 * Additive, not a replacement. `settings.section` is a pristine
 * `kind: 'list'` slot that `@deepseek-ai/dsh-client-ui-settings` declares for
 * exactly this — a feature owning its own settings page — so nothing here
 * disables a vendor row, nothing is forked, and this package has no
 * replacement-parity obligation of the kind the Models sign-in panel carries
 * (see ARCHITECTURE.md's "Replacement parity"). It still registers at
 * `priority: -1`, matching this repo's other settings registrations, so a
 * same-slot collision shadows deterministically rather than throwing.
 *
 * Resilience (see ARCHITECTURE.md's "Plugin isolation"): `remote.mcpConnectors`
 * is deliberately NOT in this plugin's top-level `inject`. This package is
 * itself a top-level loader entry, and this repo's Client boot treats ANY
 * top-level entry left pending at the end of boot as fatal for the whole
 * application — not as a silently degraded feature. A fiber nested inside an
 * already-active entry's `apply()` is invisible to that check, so the remote
 * is required by a nested `ctx.inject()` below, which may stay pending forever
 * (the remotes plugin not installed, or its own mount failed and was caught
 * rather than thrown) without blocking this plugin's activation. The section
 * then simply never registers, and the rest of Settings works normally.
 *
 * @module dsh-plugins-client-ui-settings-mcp-connector/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated ctx.remote.mcpConnectors namespace merge —
// mounted at runtime by dsh-plugins-client-remotes-mcp-connector.
import type {} from 'dsh-plugins-api-mcp-connector-controller/remote'
import { McpConnectorRuntime } from './runtime.ts'
import { McpConnectorsSection } from './McpConnectorsSection.tsx'
import type { McpConnectorsSectionInjected } from './McpConnectorsSection.tsx'
import { en, zh, type McpConnectorKey } from './locales.ts'

export { McpConnectorsSection } from './McpConnectorsSection.tsx'
export type { McpConnectorsSectionInjected, McpConnectorsSectionProps } from './McpConnectorsSection.tsx'
export { ConnectorEditor } from './ConnectorEditor.tsx'
export type { ConnectorEditorProps } from './ConnectorEditor.tsx'
export type { IMcpConnectors, McpConnectorsState, McpSignInState } from './runtime.ts'
export type { McpConnectorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The MCP connectors page copy. */
    'settings.mcp-connectors': McpConnectorKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.mcp-connectors'

/**
 * Required services.
 *
 * `remote.mcpConnectors` is deliberately absent — see this module's doc
 * comment for why requiring an optional cross-plugin key at the top level
 * would make one plugin's absence fatal to the whole Client boot.
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * Register the MCP connectors section once its Remote namespace is mounted
 * and the `settings.section` declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp-connector: copy dictionaries')
  } catch (error) {
    ctx.logger.error('dsh-plugins-client-ui-settings-mcp-connector: failed to register copy dictionaries')
    ctx.logger.error(error)
    return
  }

  void ctx.inject(['remote.mcpConnectors'], (scope) => {
    let injected: () => McpConnectorsSectionInjected
    let t: McpConnectorsSectionInjected['t']
    try {
      const runtime = new McpConnectorRuntime(scope, scope.remote.mcpConnectors)
      // Registration-time text (the nav label thunk) and the inject face share
      // one bound translate; copy freshness rides the locale revision.
      t = scope.locale.bind(NS) as McpConnectorsSectionInjected['t']
      injected = (): McpConnectorsSectionInjected => ({
        connectors: runtime,
        hooks: { snapshot: runtime.state },
        t,
      })
    } catch (error) {
      scope.logger.error(
        'dsh-plugins-client-ui-settings-mcp-connector: setup failed — the MCP connectors settings section will be unavailable',
      )
      scope.logger.error(error)
      return
    }

    scope.slots.inject('settings.section', () => {
      try {
        return scope.slots.register({
          name: 'settings.section',
          id: 'mcp-connectors',
          // Matches this repo's other settings registrations: a same-slot,
          // same-priority collision throws, while a lower priority shadows
          // deterministically.
          priority: -1,
          // After Models (10), before whatever a profile adds later.
          order: 20,
          label: () => t('nav'),
          inject: injected,
        }, McpConnectorsSection)
      } catch (error) {
        scope.logger.error(
          'dsh-plugins-client-ui-settings-mcp-connector: failed to register the settings.section mcp-connectors row',
        )
        scope.logger.error(error)
        return []
      }
    })
  })
}
