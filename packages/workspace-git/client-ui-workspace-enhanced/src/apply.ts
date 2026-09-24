/**
 * Enhanced replacement for dsh-client-ui-workspace's own browser/picker
 * plugin -- "unplug the original plugin row, plug in an enhanced
 * replacement" (see ../ARCHITECTURE.md), not a patch to the vendored
 * submodule. cordis.patch.yml disables the original ui-workspace row
 * and inserts this package instead; this file is otherwise a near-verbatim
 * port of the original's own apply(), importing everything it doesn't
 * need to change -- UiWorkspaceService, createWorkspaceViewStore,
 * WorkspacePicker, the shipped Session row actions (pin/rename/fork/
 * archive), the shortcut controls, the workspace locale dictionaries --
 * directly from dsh-client-ui-workspace's own ./src/* export, so none of
 * it is duplicated. Only WorkspaceBrowser itself is forked
 * (./WorkspaceBrowser.tsx), to add the Files sibling row.
 *
 * Fails toward the pristine plugin, not toward a crashed app (see
 * ../../../../ARCHITECTURE.md's "Plugin isolation"): apply() below
 * catches any synchronous setup failure in applyEnhanced() -- everything
 * before any slot is registered -- and falls back to calling
 * dsh-client-ui-workspace's own unmodified apply(ctx), loaded through a
 * dynamic import() rather than a static one (this package's own inject
 * array is identical to the original's, so every service the fallback needs
 * is already guaranteed available) -- see apply()'s own doc comment for why
 * the import must stay dynamic. A failure INSIDE one of the
 * ctx.slots.inject(...) callbacks below -- which can fire asynchronously,
 * after applyEnhanced() has already returned, making an outer try/catch
 * unable to see it -- is caught at that call site instead; there is no clean
 * way to fall back to just the pristine registration for one hole without
 * re-running (and thus double-registering) the whole original apply(), so
 * each of those paths logs and leaves the one affected row/entries
 * unregistered, degrading only that feature rather than the whole plugin or
 * the whole app.
 * @module dsh-plugins-client-ui-workspace-enhanced/apply
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, SessionActivity, WorkspaceArchiveError,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkspaceFilesNodeService } from 'dsh-plugins-client-ui-workspace-files/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  menuOpenStateFactory,
  type ArchiveSessionInjected, type ForkSessionInjected, type PinSessionInjected,
  type RenameSessionInjected, type RowToast, type RowToastInjected, type RowToastState,
  type SessionArchiveConfirmInjected, type SessionArchiveConfirmRequest, type SessionRenameDialogInjected,
  type WorkspaceBrowserInjected, type WorkspacePickerInjected,
} from '@deepseek-ai/dsh-client-ui-workspace/src/client/contract/slots.ts'
import { createWorkspaceShortcutControls, installWorkspaceShortcuts } from '@deepseek-ai/dsh-client-ui-workspace/src/client/shortcuts.ts'
import { UiWorkspaceService } from '@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts'
import { createWorkspaceViewStore } from '@deepseek-ai/dsh-client-ui-workspace/src/client/stores.ts'
import {
  ArchiveSessionMenuItem, ArchiveSessionRowButton, SessionArchiveConfirmDialog,
} from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/ArchiveSession.tsx'
import { derive } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/derived.ts'
import { ForkSessionMenuItem } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/ForkSession.tsx'
import { PinSessionMenuItem, PinSessionRowButton } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/PinSession.tsx'
import { RenameSessionMenuItem, SessionRenameDialog } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/RenameSession.tsx'
import { RowActionToast } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/RowActionToast.tsx'
import { WorkspacePicker } from '@deepseek-ai/dsh-client-ui-workspace/src/client/WorkspacePicker.tsx'
import { en, zh } from '@deepseek-ai/dsh-client-ui-workspace/src/client/locales.ts'
import { EnhancedWorkspaceBrowser } from './WorkspaceBrowser.tsx'

const NS = 'workspace'

export const inject = [
  'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout', 'shortcuts',
]

export async function apply(ctx: Context): Promise<void> {
  try {
    applyEnhanced(ctx)
  } catch (error) {
    ctx.logger.error(
      'dsh-plugins-client-ui-workspace-enhanced: enhanced setup failed -- falling back to the pristine dsh-client-ui-workspace plugin',
    )
    ctx.logger.error(error)
    const { apply: pristineApply } = await import('@deepseek-ai/dsh-client-ui-workspace/src/client/index.ts')
    pristineApply(ctx)
  }
}

function applyEnhanced(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const viewHandle = createWorkspaceViewStore()
  const viewInstance = viewHandle.create()
  const viewStore: typeof viewHandle = { ...viewHandle, create: () => viewInstance }
  const rowToast = createSnapshotStore<RowToastState | null>(null)
  let toastSeq = 0
  const notify = (toast: RowToast): void => { rowToast.set({ ...toast, seq: ++toastSeq }) }
  const uiWorkspace = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker, workspaces, sessions, viewInstance.actions, notify,
  )
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace-enhanced: dictionaries')
  const shortcutControls = createWorkspaceShortcutControls()

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
  const openSession: WorkspaceBrowserInjected['open'] = (sessionId) => {
    uiWorkspace.openSession(sessionId)
  }
  const pinnedSet = derive(workspaces.list, snapshot => new Set<SessionId>(snapshot.pinnedSessionIds))
  const archivedSet = derive(workspaces.list, snapshot => new Set<SessionId>(snapshot.archivedSessionIds))
  const renameRequest = derive(shortcutControls.state, state => state.renameTarget)
  const archiveRequest = createSnapshotStore<SessionArchiveConfirmRequest | null>(null)
  const requestSessionRename = shortcutControls.rename
  const unarchiveSession = (sessionId: SessionId): void => {
    uiWorkspace.unarchiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session unarchive rejected:', reason)
    })
  }
  const renameSession: SessionRenameDialogInjected['renameSession'] = async (sessionId, title) => {
    const result = await sessions.using(
      sessionId,
      { source: 'workspaceOperation' },
      reference => reference.binding.session.rename(title),
    )
    if (!result.ok) throw new Error(result.error.message)
  }
  const pinInjected = (): PinSessionInjected => ({
    hooks: { pinned: pinnedSet, archived: archivedSet },
    pinSession: (sessionId) => {
      uiWorkspace.pinSession(sessionId).catch(() => { notify({ kind: 'pinFailed' }) })
    },
    unpinSession: (sessionId) => {
      uiWorkspace.unpinSession(sessionId).catch(() => { notify({ kind: 'unpinFailed' }) })
    },
  })
  const archiveInjected = (): ArchiveSessionInjected => ({
    hooks: { archived: archivedSet },
    archiveSession: (sessionId) => {
      uiWorkspace.archiveSession(sessionId).then(() => {
        notify({ kind: 'archived', sessionId })
      }).catch((reason: unknown) => {
        const activity = activeSessionRefusal(reason)
        if (activity === undefined) {
          console.warn('session archive rejected:', reason)
          return
        }
        const displayTitle = sessions.list.getSnapshot().byId[sessionId]?.displayTitle ?? sessionId
        archiveRequest.set({ sessionId, displayTitle, activity })
      })
    },
    unarchiveSession,
  })
  installWorkspaceShortcuts(ctx, uiWorkspace, shortcutControls, archiveInjected().archiveSession)
  const archiveConfirmInjected = (): SessionArchiveConfirmInjected => ({
    hooks: { archiveRequest },
    settleSessionArchive: () => { archiveRequest.set(null) },
    stopAndArchiveSession: async (sessionId) => {
      await uiWorkspace.archiveSession(sessionId, { stopActivity: true })
      notify({ kind: 'stoppedAndArchived', sessionId })
    },
  })
  const forkInjected = (): ForkSessionInjected => ({
    forkSession: (sessionId) => {
      uiWorkspace.forkSession(sessionId).catch(() => {
      })
    },
  })
  const renameInjected = (): RenameSessionInjected => ({ requestSessionRename })
  const renameDialogInjected = (): SessionRenameDialogInjected => ({
    hooks: { renameRequest },
    settleSessionRename: shortcutControls.closeRename,
    renameSession,
  })
  const rowToastInjected = (): RowToastInjected => ({
    hooks: { toast: rowToast },
    dismissToast: () => { rowToast.set(null) },
    undoArchive: unarchiveSession,
    showArchived: () => { viewInstance.actions.setArchivedFilter('show') },
  })
  const browserInjected = (): WorkspaceBrowserInjected & {
    filesNode: WorkspaceFilesNodeService | undefined
  } => ({
    startSession: (workspaceId) => { uiWorkspace.startSession(workspaceId) },
    open: openSession,
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    requestSessionRename,
    notifyArchivedNotOpenable: () => { notify({ kind: 'archivedNotOpenable' }) },
    renameWorkspace: async (workspaceId, title) => { await workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    unarchiveSession: async (sessionId) => { await uiWorkspace.unarchiveSession(sessionId) },
    createWorkspace: input => workspaces.create(input),
    requestSearch: shortcutControls.search,
    requestAddWorkspace: shortcutControls.add,
    closeAddWorkspace: shortcutControls.closeAdd,
    setDirectoryBusy: shortcutControls.directoryBusy,
    dismissForkError: shortcutControls.dismissForkError,
    hooks: { directoryFlow: browserFlowSource, hostInfo, workspaceShortcuts: shortcutControls.state, shortcuts: ctx.shortcuts.catalog },
    filesNode: ctx.get('workspaceFilesNode') as WorkspaceFilesNodeService | undefined,
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  ctx.slots.inject('sidebar.workspaces', () => {
    try {
      return ctx.slots.register(
        {
          name: 'sidebar.workspaces',
          priority: -1,
          children: {
            'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
            'sidebar.workspaces.session.menu.item': {
              kind: 'list', scope: 'root', inject: { hooks: { menuOpenState: menuOpenStateFactory, shortcuts: ctx.shortcuts.catalog } },
            },
            'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
            'sidebar.session.row.leading': { kind: 'list', scope: 'root' },
            'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
          },
          store: viewStore,
          inject: browserInjected,
          locale: NS,
        },
        EnhancedWorkspaceBrowser,
      )
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-workspace-enhanced: failed to register the sidebar.workspaces row')
      ctx.logger.error(error)
      return []
    }
  })
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => {
    try {
      return [
        ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'pin', order: 100, locale: NS, inject: pinInjected }, PinSessionMenuItem),
        ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'rename', order: 200, locale: NS, inject: renameInjected }, RenameSessionMenuItem),
        ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'fork', order: 300, locale: NS, inject: forkInjected }, ForkSessionMenuItem),
        ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'archive', order: 400, locale: NS, inject: archiveInjected }, ArchiveSessionMenuItem),
      ].flat()
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-workspace-enhanced: failed to register the sidebar.workspaces.session.menu.item entries')
      ctx.logger.error(error)
      return []
    }
  })
  ctx.slots.inject('sidebar.workspaces.session.row.action', () => {
    try {
      return [
        ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'archive', order: 100, locale: NS, inject: archiveInjected }, ArchiveSessionRowButton),
        ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'pin', order: 200, locale: NS, inject: pinInjected }, PinSessionRowButton),
      ].flat()
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-workspace-enhanced: failed to register the sidebar.workspaces.session.row.action entries')
      ctx.logger.error(error)
      return []
    }
  })
  ctx.slots.inject('shell.overlay', () => {
    try {
      return [
        ctx.slots.register({
          name: 'shell.overlay', id: 'workspace.session-rename', locale: NS, inject: renameDialogInjected,
        }, SessionRenameDialog),
        ctx.slots.register({
          name: 'shell.overlay', id: 'workspace.session-archive', locale: NS, inject: archiveConfirmInjected,
        }, SessionArchiveConfirmDialog),
        ctx.slots.register({
          name: 'shell.overlay', id: 'workspace.row-toast', locale: NS, store: viewStore, inject: rowToastInjected,
        }, RowActionToast),
      ].flat()
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-workspace-enhanced: failed to register the workspace shell.overlay entries')
      ctx.logger.error(error)
      return []
    }
  })
  ctx.slots.inject('conversation.hero.workspace', () => {
    try {
      return ctx.slots.register(
        {
          name: 'conversation.hero.workspace',
          priority: -1,
          children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
          inject: pickerInjected,
          locale: NS,
        },
        WorkspacePicker,
      )
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-workspace-enhanced: failed to register the conversation.hero.workspace row')
      ctx.logger.error(error)
      return []
    }
  })
}

function activeSessionRefusal(reason: unknown): readonly SessionActivity[] | undefined {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined
  const { rpcError } = reason as WorkspaceArchiveError
  return rpcError.code === 'workspace/session-active' ? rpcError.details.activity : undefined
}
