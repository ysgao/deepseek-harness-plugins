/**
 * Browser-only entry: mounts this bundle's own generated Remote
 * contributions — `dsh-plugins-api-workspace-file-controller` and
 * `dsh-plugins-api-workspace-git-controller` — the Client-side composition
 * role `@deepseek-ai/dsh-api-remotes` fills for every other namespace in
 * this app, but can't for these two: that vendored assembly is a static,
 * hand-curated list unaware of out-of-tree plugins, and
 * `dsh-typert-loader`'s auto-discovery only covers a package's Host
 * `./typert` half (its own README documents this as a known limitation —
 * the Client `./remote` half needs an explicit composition owner).
 *
 * Kept as its own dedicated plugin, not folded into
 * `dsh-plugins-client-ui-workspace-enhanced` (an earlier revision did
 * exactly that): that package's `apply()` also registers the core
 * `sidebar.workspaces`/`conversation.hero.workspace` slots, so a `$mount`
 * failure inside its own `apply()` would have thrown the whole function and
 * taken the Workspace sidebar down with it — a plugin that adds an optional
 * Files/git-status feature must never be able to break the Workspace
 * sidebar itself. This plugin's `apply()` does nothing else, so a mount
 * failure here stays local to its own fiber: every consumer
 * (`dsh-plugins-client-ui-workspace-files`,
 * `dsh-plugins-client-ui-conversation-files`) injects
 * `remote.workspace-files`/`remote.workspace-git` and simply stays pending
 * per Cordis's ordinary lazy-activation semantics — degrading only the
 * feature that needs those two namespaces, never anything else.
 * @module dsh-plugins-client-remotes-workspace-git/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote Context merge (ClientRemote).
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import workspaceFileRemote from 'dsh-plugins-api-workspace-file-controller/remote'
import workspaceGitRemote from 'dsh-plugins-api-workspace-git-controller/remote'

/** Required Client services. */
export const inject = ['remote']

/**
 * Mount both Remote contributions.
 * @param ctx - Client root Context.
 * @returns disposer unmounting both Remote contributions in reverse order.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [workspaceFileRemote, workspaceGitRemote]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
