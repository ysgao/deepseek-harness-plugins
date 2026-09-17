/**
 * Browser-only entry: mounts this bundle's own generated Remote contribution
 * — `dsh-plugins-api-mcp-connector-controller`, the `mcpConnectors`
 * namespace. This is the Client-side composition role
 * `@deepseek-ai/dsh-api-remotes` fills for every other namespace in the app
 * but cannot for an out-of-tree one: that vendored assembly is a static,
 * hand-curated list, and `dsh-typert-loader`'s auto-discovery covers only a
 * package's Host `./typert` half (its own README names this a known
 * limitation).
 *
 * Its own dedicated plugin, doing nothing else, for the reason
 * `dsh-plugins-client-remotes-workspace-git` and
 * `dsh-plugins-client-remotes-anthropic-subscription` both document: a plugin
 * that mounts a `remote.<namespace>` contribution can never also be the
 * plugin that renders UI, because a `$mount` failure would throw that
 * plugin's whole `apply()` and take the UI down with it.
 *
 * That isolation alone is not enough. This repo's Client loader treats ANY
 * top-level entry's `apply()` throwing as fatal to the ENTIRE client boot — a
 * blank "Failed to load plugins" page for every feature, not just this one.
 * So `apply()` catches a `$mount` failure and logs it instead of rethrowing:
 * the MCP connectors settings page then simply stays pending on its own
 * nested `remote.mcpConnectors` inject, degrading one page rather than the
 * application.
 *
 * @module dsh-plugins-client-remotes-mcp-connector/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote Context merge (ClientRemote).
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import mcpConnectorsRemote from 'dsh-plugins-api-mcp-connector-controller/remote'

/**
 * Required Client services.
 *
 * `remote` only — never `remote.mcpConnectors`, the key this plugin itself
 * provides: Cordis will not call a plugin's `apply()` until its declared
 * `inject` is satisfied, so a plugin that mounts a namespace can never also
 * inject it.
 */
export const inject = ['remote']

/**
 * Mount the Remote contribution.
 * @param ctx - Client root Context.
 * @returns disposer unmounting the contribution, or a no-op if the mount itself failed.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  try {
    return await ctx.remote.$mount(mcpConnectorsRemote)
  } catch (error) {
    ctx.logger.error(
      'dsh-plugins-client-remotes-mcp-connector: failed to mount the mcpConnectors Remote contribution — '
      + 'the Settings > MCP connectors page will stay unavailable',
    )
    ctx.logger.error(error)
    return async () => {}
  }
}
