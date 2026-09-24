/**
 * Browser-only entry: File tree sidebar entry (`FilesNode`), its in-app
 * preview (`FileViewer`), and git status/action buttons (commit, fetch,
 * pull `--rebase`, push, discard, add file/folder) — ported from
 * `yga/deepseek-harness`'s direct edits to `dsh-client-ui-workspace`,
 * `dsh-api-workspace-controller`, and `dsh-client-ui-primitives` into an
 * out-of-tree package with its own Typert namespaces
 * ({@link dsh-plugins-api-workspace-file-controller},
 * {@link dsh-plugins-api-workspace-git-controller}) and its own locale
 * namespace ({@link WORKSPACE_FILES_NS}).
 *
 * Registers the optional `workspaceFilesNode` service (see `../service.ts`)
 * that the upstream-ready `WorkspaceBrowser` diff (ARCHITECTURE.md Task 19)
 * resolves to render the Files sibling row in a real Workspace group — the
 * same mount point `FilesNode` occupied before this package existed. Until
 * that diff lands, this plugin composes and typechecks cleanly but has no
 * mount point in a real `dsh-client-ui-workspace` build.
 *
 * Kept under `./client`, separate from the package's default `.` export
 * (`../index.ts`, a Host-safe no-op): this module transitively imports
 * `dsh-client-ui-primitives`' CSS Modules (e.g. `StateDot`), which a plain
 * Node ESM import cannot resolve (`ERR_UNKNOWN_FILE_EXTENSION`) — only a
 * browser bundle's CSS-modules-inline transform handles them. The Host
 * Loader imports every entry's DEFAULT export during composition (even for
 * a Client-face row); only the browser-side loader
 * (`packages/client/web`, vendored) ever resolves `./client`.
 * @module dsh-plugins-client-ui-workspace-files/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote Context merge (ClientRemote).
import type {} from '@deepseek-ai/dsh-api-gateway/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: this package's own generated Remote namespace merges, and the
// two contributions mounted by dsh-plugins-client-ui-workspace-enhanced
// (see that package's apply.ts) before this package's own apply() runs —
// Cordis requires the reading fiber's own `inject` to name a service
// (`remote.<namespace>`), so the plugin that calls `ctx.remote.$mount()`
// for a namespace can never be the same plugin that also injects that
// namespace's own key (a self-cycle Cordis's activation would deadlock
// on): the mount lives in workspace-enhanced instead.
import type {} from 'dsh-plugins-api-workspace-file-controller/remote'
import type {} from 'dsh-plugins-api-workspace-git-controller/remote'
// Type-only: pulls ctx.remote.session (openWorkspacePath), already required
// by dsh-client-ui-workspace itself for the identical capability.
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
// Type-only: pulls ctx.shortcuts' own Context merge and its command id brand.
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
// Type-only: pulls ctx.layout's Context merge (read optionally, via ctx.get).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createFilesReveal } from '../reveal.ts'
import { createWorkspaceFilesNodeService } from '../WorkspaceFilesNode.tsx'
import { WORKSPACE_FILES_NS } from '../locale-ns.ts'
import { en, zh } from '../locales.ts'
import type { FilesKey } from '../locales.ts'

export { WORKSPACE_FILES_NS } from '../locale-ns.ts'
export type { WorkspaceFilesNodeProps, WorkspaceFilesNodeService } from '../service.ts'
export type { FilesKey } from '../locales.ts'
export { FilesNode } from '../FilesNode.tsx'
export type { FilesNodeProps } from '../FilesNode.tsx'
export { FileViewer } from '../FileViewer.tsx'
export type { FileViewerProps } from '../FileViewer.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'workspace-files': FilesKey
  }
}

/** Required Client services. Both namespace sub-keys are required alongside the
 * parent 'remote': the ctx.remote[...] property proxy is topology-sensitive and
 * only resolves a namespace declared here, unlike ctx.get('remote'). */
export const inject = ['locale', 'remote', 'remote.workspace-files', 'remote.workspace-git']

/**
 * Register the `workspace-files` locale dictionaries, the
 * `workspaceFilesNode` optional service, and the `workspace.files` command.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.locale.register(WORKSPACE_FILES_NS, { zh, en })
  const t = ctx.locale.bind(WORKSPACE_FILES_NS)
  const reveal = createFilesReveal()
  ctx.provide('workspaceFilesNode', createWorkspaceFilesNodeService(ctx, reveal))
  // `workspace.files` is @deepseek-ai/dsh-client-ui-sidebar-files' command id
  // and its exact key defaults, taken over here because this bundle disables
  // that row (see ../../bundle-workspace-git/cordis.patch.yml): the keystroke
  // a user already has in their fingers keeps meaning "show me the files",
  // and now shows them the Files tree in the left Sidebar instead of opening
  // a second one on the right.
  //
  // Registered under `ctx.inject(['shortcuts'])` rather than named in this
  // plugin's own `inject`: the tree and the service must mount in a
  // composition that has no shortcuts plugin at all, and a keyboard command
  // is exactly the kind of thing whose absence degrades.
  ctx.inject(['shortcuts'], (ctx) => {
    ctx.effect(() => ctx.shortcuts.register({
      id: 'workspace.files' as ShortcutCommandId,
      label: () => t('files.label'),
      aliases: ['workspace files', 'files'],
      defaults: {
        'desktop:macos': { code: 'KeyP', modifiers: ['primary'] },
        'desktop:windows': { code: 'KeyP', modifiers: ['primary'] },
        'desktop:linux': { code: 'KeyP', modifiers: ['primary'] },
        'web:macos': { code: 'KeyP', modifiers: ['primary', 'alt'] },
        'web:windows': { code: 'KeyP', modifiers: ['primary', 'alt'] },
      },
      regions: ['page', 'editable', 'terminal'],
      modals: [],
      resolve: () => ({
        status: 'handled',
        run: () => {
          // The Sidebar may be collapsed, in which case no tree is on screen
          // to answer. Ask first, then look: a tree that focused itself has
          // a focused element inside the Sidebar, and one that could not is
          // the signal to open it. Never an unconditional toggle — the face
          // exposes only `toggleSidebar()`, which would close an already
          // open Sidebar and hide the very thing being asked for.
          reveal.request()
          const revealed = typeof document !== 'undefined'
            && document.activeElement instanceof HTMLElement
            && document.activeElement.getBoundingClientRect().width > 0
          if (revealed) return
          ctx.get('layout')?.toggleSidebar()
          // The Sidebar mounts its tree in the same commit; the request that
          // found nothing is re-sent once it exists.
          requestAnimationFrame(() => { reveal.request() })
        },
      }),
    }), 'workspace-files: workspace.files command')
  })
}
