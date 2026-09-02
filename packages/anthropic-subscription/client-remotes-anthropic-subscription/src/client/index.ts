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
 * plugin's whole `apply()` and take the UI down with it.
 *
 * That isolation alone is not sufficient: this repo's Client loader treats
 * ANY top-level entry's `apply()` throwing as fatal to the ENTIRE client
 * boot (a blank "Failed to load plugins" page for every feature, confirmed
 * by deliberately breaking this mount during development), not just to this
 * plugin's own fiber. So `apply()` below also catches and logs a `$mount`
 * failure instead of letting it propagate — the Settings > Models sign-in
 * panel (`dsh-plugins-client-ui-settings-anthropic-subscription`) simply
 * stays pending forever on its own `remote.authorization` inject per
 * Cordis's ordinary lazy-activation semantics, degrading only that one
 * feature, while the rest of the app boots normally.
 * @module dsh-plugins-client-remotes-anthropic-subscription/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote Context merge (ClientRemote).
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import authorizationRemote from 'dsh-plugins-api-authorization-controller/remote'

/** Required Client services. */
export const inject = ['remote']

/**
 * Mount the Remote contribution. A failure is caught and logged rather than
 * thrown: the Client loader treats a throwing top-level entry as fatal to
 * the whole app, so this degrades only the Settings > Models sign-in panel
 * instead of taking every feature down with it.
 * @param ctx - Client root Context.
 * @returns disposer unmounting the Remote contribution, or a no-op if the mount itself failed.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  try {
    return await ctx.remote.$mount(authorizationRemote)
  } catch (error) {
    ctx.logger.error(
      'dsh-plugins-client-remotes-anthropic-subscription: failed to mount the authorization Remote '
      + 'contribution — the Settings > Models sign-in panel will stay unavailable',
    )
    ctx.logger.error(error)
    return async () => {}
  }
}
