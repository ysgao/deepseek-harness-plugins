/**
 * Browser-only entry: mounts this bundle's own generated Remote
 * contribution — `dsh-plugins-api-authorization-controller`, the
 * `authorization` namespace — the Client-side composition role
 * `@deepseek-ai/dsh-api-remotes` fills for every other namespace in this
 * app, but can't for this one: that vendored assembly is a static,
 * hand-curated list unaware of out-of-tree plugins, and
 * `dsh-typert-loader`'s auto-discovery only covers a package's Host
 * `./typert` half (its own README documents this as a known limitation —
 * the Client `./remote` half needs an explicit composition owner).
 *
 * Kept as its own dedicated plugin — see
 * `dsh-plugins-client-remotes-workspace-git`'s own doc comment for the full
 * rationale, discovered while fixing the same gap there: a plugin that
 * mounts a `remote.<namespace>` contribution can never also be the plugin
 * that renders unrelated UI, because a mount failure would throw that
 * plugin's whole `apply()` and take the UI down with it. This plugin's
 * `apply()` does nothing else, so a mount failure here stays local to its
 * own fiber — any future consumer (e.g. the Settings > Models sign-in
 * panel, `dsh-plugins-client-ui-settings-anthropic-subscription`, not yet
 * implemented) would inject `remote.authorization` and simply stay pending
 * per Cordis's ordinary lazy-activation semantics if this plugin never
 * mounts it, degrading only that one feature.
 * @module dsh-plugins-client-remotes-anthropic-subscription/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote Context merge (ClientRemote).
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import authorizationRemote from 'dsh-plugins-api-authorization-controller/remote'

/** Required Client services. */
export const inject = ['remote']

/**
 * Mount the Remote contribution.
 * @param ctx - Client root Context.
 * @returns disposer unmounting the Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const dispose = await ctx.remote.$mount(authorizationRemote)
  return dispose
}
