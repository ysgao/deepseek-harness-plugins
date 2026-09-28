/**
 * Browser-only entry: mounts this bundle's own generated Remote
 * contributions — `dsh-plugins-api-workspace-file-controller`,
 * `dsh-plugins-api-workspace-git-controller`, and
 * `dsh-plugins-api-file-sentence-controller` — the Client-side composition
 * role `@deepseek-ai/dsh-api-remotes` fills for every other namespace in
 * this app, but can't for these: that vendored assembly is a static,
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
 * sidebar itself.
 *
 * That isolation alone is not sufficient: this repo's Client loader treats
 * ANY top-level entry's `apply()` throwing as fatal to the ENTIRE client
 * boot (a blank "Failed to load plugins" page for every feature, confirmed
 * by deliberately breaking a mount during development — see
 * `dsh-plugins-client-remotes-anthropic-subscription`'s own doc comment,
 * where this was discovered), not just to this plugin's own fiber. So
 * `apply()` below also catches and logs a `$mount` failure (after rolling
 * back any partial mounts) instead of letting it propagate: every consumer
 * (`dsh-plugins-client-ui-workspace-files`,
 * `dsh-plugins-client-ui-conversation-files`) injects
 * `remote.workspace-files`/`remote.workspace-git`/`remote.fileSentence` and
 * simply stays pending forever per Cordis's ordinary lazy-activation
 * semantics — degrading only the feature that needs those namespaces, while
 * the rest of the app boots normally. `fileSentence` backs an optional
 * editing aid (model-backed ghost text) layered over a heuristic that
 * already works without it, so its own consumer degrades further still —
 * see `dsh-plugins-client-ui-conversation-files`'s own doc comments.
 * @module dsh-plugins-client-remotes-workspace-git/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote Context merge (ClientRemote).
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import workspaceFileRemote from 'dsh-plugins-api-workspace-file-controller/remote'
import workspaceGitRemote from 'dsh-plugins-api-workspace-git-controller/remote'
import fileSentenceRemote from 'dsh-plugins-api-file-sentence-controller/remote'

/** Required Client services. */
export const inject = ['remote']

/**
 * Mount every Remote contribution. A failure is caught and logged, after
 * rolling back any contribution that mounted before the failing one, rather
 * than thrown: the Client loader treats a throwing top-level entry as fatal
 * to the whole app, so this degrades only the Workspace Files/git-status/
 * ghost-text features instead of taking every feature down with it.
 * @param ctx - Client root Context.
 * @returns disposer unmounting every Remote contribution in reverse order, or a no-op if the mount itself failed.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [workspaceFileRemote, workspaceGitRemote, fileSentenceRemote]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    ctx.logger.error(
      'dsh-plugins-client-remotes-workspace-git: failed to mount a Remote contribution — '
      + 'Workspace Files/git-status/ghost-text features will stay unavailable',
    )
    ctx.logger.error(error)
    return async () => {}
  }
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
