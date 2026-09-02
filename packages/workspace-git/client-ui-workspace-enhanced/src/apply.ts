/**
 * Enhanced replacement for `dsh-client-ui-workspace`'s own browser/picker
 * plugin — "unplug the original plugin row, plug in an enhanced
 * replacement" (see ../ARCHITECTURE.md), not a patch to the vendored
 * submodule. `cordis.patch.yml` disables the original `ui-workspace` row
 * and inserts this package instead; this file is otherwise a near-verbatim
 * port of the original's own `apply()`, importing everything it doesn't
 * need to change — `UiWorkspaceService`, `createWorkspaceViewStore`,
 * `WorkspacePicker`, the `workspace` locale dictionaries — directly from
 * `@deepseek-ai/dsh-client-ui-workspace`'s own `./src/*` export, so none of
 * it is duplicated. Only `WorkspaceBrowser` itself is forked
 * (`./WorkspaceBrowser.tsx`), to add the Files sibling row.
 * @module dsh-plugins-client-ui-workspace-enhanced/apply
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-hook merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the owner SlotMap merges for 'sidebar.workspaces' and
// 'conversation.hero.workspace' (declared by these packages, not by
// dsh-client-ui-workspace itself) plus the shell's wide/expandSidebar
// GlobalStandardProps share.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the optional workspaceFilesNode Context service merge.
import type { WorkspaceFilesNodeService } from 'dsh-plugins-client-ui-workspace-files/client'
// Type-only: pulls the original package's own GlobalStandardProps.useWorkspaces
// and LocaleNamespaceMap.workspace merges — these are pure type declarations,
// unaffected by cordis.patch.yml disabling the original package's *runtime*
// apply(); redeclaring them here would conflict, not duplicate safely.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {
  WorkspaceBrowserInjected, WorkspacePickerInjected,
} from '@deepseek-ai/dsh-client-ui-workspace/src/client/contract/slots.ts'
import { UiWorkspaceService } from '@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts'
import { createWorkspaceViewStore } from '@deepseek-ai/dsh-client-ui-workspace/src/client/stores.ts'
import { WorkspacePicker } from '@deepseek-ai/dsh-client-ui-workspace/src/client/WorkspacePicker.tsx'
import { en, zh } from '@deepseek-ai/dsh-client-ui-workspace/src/client/locales.ts'
import { EnhancedWorkspaceBrowser } from './WorkspaceBrowser.tsx'

/** Dictionary namespace owned by this plugin — same namespace, same dictionaries, as the original it replaces. */
const NS = 'workspace'

/**
 * Required services (cordis fiber inject). Same as the original plugin —
 * see its own doc comment for why activation order relative to the slot
 * declarations is deliberately unconstrained.
 */
export const inject = [
  'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker',
]

/**
 * Register the enhanced browser and the unmodified picker once their slot
 * declarations are on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const uiWorkspace = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker, workspaces, sessions)
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace-enhanced: dictionaries')

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const browserInjected = (): WorkspaceBrowserInjected & {
    /** Optional Files sibling row; `undefined` when `dsh-plugins-client-ui-workspace-files` isn't composed in. */
    filesNode: WorkspaceFilesNodeService | undefined
  } => ({
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId) => { uiWorkspace.startSession(workspaceId) },
    open: (sessionId) => { sessions.open(sessionId) },
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: (sessionId) => {
      sessions.fork({ sessionId, increaseTitle: true })
        .then((childId) => { sessions.open(childId) })
        .catch(() => {
          // Fork or child-rename failure keeps the current selection.
        })
    },
    renameWorkspace: async (workspaceId, title) => { await workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await uiWorkspace.archiveSession(sessionId) },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: browserFlowSource, hostInfo },
    filesNode: ctx.get('workspaceFilesNode') as WorkspaceFilesNodeService | undefined,
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
      store: createWorkspaceViewStore(),
      inject: browserInjected,
      locale: NS,
    },
    EnhancedWorkspaceBrowser,
  ))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}
