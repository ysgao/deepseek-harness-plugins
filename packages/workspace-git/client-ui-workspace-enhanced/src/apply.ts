/**
 * Enhanced replacement for dsh-client-ui-workspace's own browser/picker
 * plugin -- "unplug the original plugin row, plug in an enhanced
 * replacement" (see ../ARCHITECTURE.md), not a patch to the vendored
 * submodule. cordis.patch.yml disables the original ui-workspace row
 * and inserts this package instead; this file is otherwise a near-verbatim
 * port of the original's own apply(), importing everything it doesn't
 * need to change -- UiWorkspaceService, createWorkspaceViewStore,
 * WorkspacePicker, WorkspacePickerFactory, the shipped Session row actions
 * (pin/rename/fork/archive/mark-read, now registered as structured
 * ctx.contextMenus contributions through registerSessionMenus, plus the
 * SessionMenu adapter that still renders the legacy external-entry Slot),
 * the shortcut controls, the workspace toast registrations
 * (registerToasts), and the workspace locale dictionaries -- directly from
 * dsh-client-ui-workspace's own ./src/* export, so none of it is
 * duplicated. Only WorkspaceBrowser itself is forked
 * (./WorkspaceBrowser.tsx), to add the Files sibling row.
 *
 * Fails toward the pristine plugin, not toward a crashed app (see
 * ../../../../ARCHITECTURE.md's "Plugin isolation"): apply() below
 * catches any synchronous setup failure in applyEnhanced() -- everything
 * before any slot is registered -- and falls back to calling
 * dsh-client-ui-workspace's own unmodified apply(ctx, config), loaded
 * through a dynamic import() rather than a static one (this package's own
 * inject array is identical to the original's, so every service the
 * fallback needs is already guaranteed available) -- see apply()'s own doc
 * comment for why the import must stay dynamic. A failure INSIDE one of the
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
import {
  IconArchiveOutlineRegular, IconBranchOutlineRegular, IconCopyOutlineRegular, IconEditOutlineRegular,
  IconMailReadOutlineRegular, IconMailUnreadOutlineRegular, IconPinFillRegular, IconPinOutlineRegular,
  IconTrashOutlineRegular, IconUnarchiveOutlineRegular, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SyncedConfig } from '@deepseek-ai/dsh-client-config/types'
import type { WorkspaceNavigationConfig } from '@deepseek-ai/dsh-client-ui-workspace/src/types.ts'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SessionForkError } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, SessionActivity, WorkspaceArchiveError, WorkspaceId,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-status/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { WorkspaceFilesNodeService } from 'dsh-plugins-client-ui-workspace-files/client'
import type { ArchiveNotice } from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the 'workspace.toast'/'workspace.toast.content' SlotMap merges.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/src/client/contract/toast.ts'
import {
  menuOpenStateFactory,
  type ArchiveSessionInjected, type DirectoryFlowSlotName, type ForkSessionInjected, type PinSessionInjected,
  type RenameSessionInjected, type RowToast, type RowToastInjected, type RowToastState,
  type SessionArchiveConfirmInjected, type SessionArchiveConfirmRequest, type SessionIdInjected,
  type SessionRenameDialogInjected, type WorkspaceActionRequest,
  type WorkspaceBrowserInjected, type WorkspacePickerInjected,
} from '@deepseek-ai/dsh-client-ui-workspace/src/client/contract/slots.ts'
import { createWorkspaceShortcutControls, installWorkspaceShortcuts } from '@deepseek-ai/dsh-client-ui-workspace/src/client/shortcuts.ts'
import { UiWorkspaceService } from '@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts'
import { createWorkspaceViewStore } from '@deepseek-ai/dsh-client-ui-workspace/src/client/stores.ts'
import {
  ArchiveSessionRowButton, SessionArchiveConfirmDialog,
} from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/ArchiveSession.tsx'
import { derive } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/derived.ts'
import { registerSessionMenus } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/context-menus.tsx'
import { SessionMenu } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/SessionMenu.tsx'
import { PinSessionRowButton } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/PinSession.tsx'
import { SessionRenameDialog } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/RenameSession.tsx'
import { RowActionToast } from '@deepseek-ai/dsh-client-ui-workspace/src/client/session-actions/RowActionToast.tsx'
import { registerToasts } from '@deepseek-ai/dsh-client-ui-workspace/src/client/toast/register.ts'
import { WorkspacePicker, WorkspacePickerFactory } from '@deepseek-ai/dsh-client-ui-workspace/src/client/WorkspacePicker.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from '@deepseek-ai/dsh-client-ui-workspace/src/client/locales.ts'
import { EnhancedWorkspaceBrowser } from './WorkspaceBrowser.tsx'

// Mirrors the vendor ui-workspace apply's own merge (contract/slots.ts),
// restated here rather than relied on transitively: the 'workspace' context
// menu target this file registers below needs it, and declaration merging
// is idempotent, so restating it beside its own use is a safety net, not a
// second source of truth that could drift from vendor's own.
declare module '@deepseek-ai/dsh-client-ui-context-menu/client' {
  interface ContextMenuTargetMap {
    /** Registered Workspace header; path and title belong to the clicked row. */
    workspace: { readonly workspaceId: WorkspaceId; readonly path: string; readonly displayTitle: string }
  }
}

const NS = 'workspace'

export const inject = ['contextMenus',
  'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout', 'shortcuts', 'remoteAccess',
  'uiSession', 'uiSession.sessionStatus',
]

export async function apply(ctx: Context, config: SyncedConfig<WorkspaceNavigationConfig>): Promise<void> {
  try {
    applyEnhanced(ctx, config)
  } catch (error) {
    ctx.logger.error(
      'dsh-plugins-client-ui-workspace-enhanced: enhanced setup failed -- falling back to the pristine dsh-client-ui-workspace plugin',
    )
    ctx.logger.error(error)
    const { apply: pristineApply } = await import('@deepseek-ai/dsh-client-ui-workspace/src/client/index.ts')
    pristineApply(ctx, config)
  }
}

function applyEnhanced(ctx: Context, config: SyncedConfig<WorkspaceNavigationConfig>): void {
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const viewHandle = createWorkspaceViewStore()
  const viewInstance = viewHandle.create()
  const viewStore: typeof viewHandle = { ...viewHandle, create: () => viewInstance }
  const rowToast = createSnapshotStore<RowToastState | null>(null)
  let toastSeq = 0
  const notify = (toast: RowToast): void => { rowToast.set({ ...toast, seq: ++toastSeq }) }
  const uiWorkspace = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker, workspaces, sessions, viewInstance.actions, notify, config.recentViewLimit,
  )
  ctx.slots.provideRoot({
    hooks: { workspaces: workspaces.list },
    keyedHooks: {
      workspaceAccess: (workspaceId, action) => action === undefined
        ? undefined
        : ctx.remoteAccess.source('workspace', workspaceId, action),
    },
  })
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-workspace-enhanced: dictionaries')
  const shortcutControls = createWorkspaceShortcutControls()

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  const flowSource = (hole: DirectoryFlowSlotName): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const factoryFlowSource = flowSource('workspace.picker.directoryFlow')
  const openSession: WorkspaceBrowserInjected['open'] = (sessionId) => {
    uiWorkspace.openSession(sessionId)
  }
  const pinnedSet = derive(workspaces.list, snapshot => new Set<SessionId>(snapshot.pinnedSessionIds))
  const archivedSet = derive(workspaces.list, snapshot => new Set<SessionId>(snapshot.archivedSessionIds))
  const markSession = (sessionId: SessionId, unread: boolean): void => {
    ctx.uiSession.sessionStatus.mark(sessionId, unread).catch(() => { notify({ kind: 'readingFailed' }) })
  }
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
  ctx.on('workspace/archive-followup-failed', (sessionId, text) => {
    if (archivedSet.getSnapshot().has(sessionId)) notify({ kind: 'archived', sessionId, message: text, tone: 'warning' })
  })
  ctx.on('workspace/archive-followup-settled', (sessionId) => {
    if (archivedSet.getSnapshot().has(sessionId)) notify({ kind: 'archived', sessionId })
  })
  const archiveNotice = async (sessionId: SessionId, kind: 'archived' | 'stoppedAndArchived'): Promise<void> => {
    let message: ArchiveNotice | undefined
    try {
      message = await ctx.waterfall('workspace/archive-notice', sessionId, () => Promise.resolve(undefined))
    } catch (error) {
      console.warn('session archive notice unavailable:', error)
    }
    notify({ kind, sessionId, ...message === undefined ? {} : { message: message.text, tone: message.tone } })
  }
  const archiveInjected = (): ArchiveSessionInjected => ({
    hooks: { archived: archivedSet },
    archiveSession: (sessionId) => {
      uiWorkspace.archiveSession(sessionId).then(() => archiveNotice(sessionId, 'archived')).catch((reason: unknown) => {
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
  installWorkspaceShortcuts(ctx, uiWorkspace, shortcutControls, archiveInjected().archiveSession,
    (reason) => { notify({ kind: 'shortcutForkFailed', reason }) }, markSession)
  const archiveConfirmInjected = (): SessionArchiveConfirmInjected => ({
    hooks: { archiveRequest },
    settleSessionArchive: () => { archiveRequest.set(null) },
    stopAndArchiveSession: async (sessionId) => {
      await uiWorkspace.archiveSession(sessionId, { stopActivity: true })
      await archiveNotice(sessionId, 'stoppedAndArchived')
    },
  })
  const forkInjected = (): ForkSessionInjected => ({
    forkSession: (sessionId) => {
      uiWorkspace.forkSession(sessionId, (childId) => {
        ctx.get('productAnalytics')?.track('branch_session_click', { session_id: childId, parent_session_id: sessionId, click_position: 'sidebar' })
      }, { allowMigration: false }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'SessionForkError'
          && (error as SessionForkError).rpcError.code === 'session/migration-required') {
          notify({ kind: 'forkRequiresOpen', sessionId })
        }
      })
    },
  })
  const sessionIdInjected = (): SessionIdInjected => ({
    copySessionId: async (sessionId) => {
      const copied = await writeClipboard(sessionId)
      notify({ kind: copied ? 'sessionIdCopied' : 'sessionIdCopyFailed' })
    },
  })
  const renameInjected = (): RenameSessionInjected => ({ requestSessionRename })
  const renameDialogInjected = (): SessionRenameDialogInjected => ({
    hooks: { renameRequest },
    settleSessionRename: shortcutControls.closeRename,
    renameSession,
  })
  const toastActions = {
    undoArchive: unarchiveSession,
    showArchived: () => { viewInstance.actions.setArchivedFilter('show') },
    openForkSource: (sessionId: SessionId) => {
      if (workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
        notify({ kind: 'archivedNotOpenable' })
        return
      }
      openSession(sessionId)
    },
  }
  registerToasts(ctx, viewStore, toastActions)
  const rowToastInjected = (): Pick<RowToastInjected, 'hooks' | 'dismissToast'> => ({
    hooks: { toast: rowToast },
    dismissToast: () => { rowToast.set(null) },
  })
  const workspaceActionRequest = createSnapshotStore<WorkspaceActionRequest | null>(null)
  const requestWorkspaceAction = (workspaceId: WorkspaceId, displayTitle: string, action: 'rename' | 'delete'): void => {
    const workspace = workspaces.list.getSnapshot().items.find(row => row.workspaceId === workspaceId)
    if (workspace === undefined || !ctx.remoteAccess.source('workspace', workspaceId, `workspace/${action}`).getSnapshot()) return
    workspaceActionRequest.set({ action, workspaceId, displayTitle, storedTitle: workspace.title })
  }
  ctx.slots.inject('contextMenu.icon', () => {
    try {
      return Object.entries({
        'workspace.rename': IconEditOutlineRegular, 'workspace.delete': IconTrashOutlineRegular,
        'workspace.pin': IconPinOutlineRegular, 'workspace.unpin': IconPinFillRegular,
        'workspace.archive': IconArchiveOutlineRegular, 'workspace.unarchive': IconUnarchiveOutlineRegular,
        'workspace.fork': IconBranchOutlineRegular, 'workspace.copy': IconCopyOutlineRegular,
        'workspace.markRead': IconMailReadOutlineRegular, 'workspace.markUnread': IconMailUnreadOutlineRegular,
      }).map(([key, Icon]) => ctx.slots.register({ name: 'contextMenu.icon', key }, Icon))
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-workspace-enhanced: failed to register the contextMenu.icon entries')
      ctx.logger.error(error)
      return []
    }
  })
  ctx.effect(() => ctx.contextMenus.register({
    id: 'workspace.rename', target: 'workspace', order: 100,
    resolve: ({ workspaceId, displayTitle }) => ctx.remoteAccess.source('workspace', workspaceId, 'workspace/rename').getSnapshot()
      ? [{ id: 'rename', label: ctx.locale.bind(NS)('rename'), icon: { key: 'workspace.rename' }, run: () => { requestWorkspaceAction(workspaceId, displayTitle, 'rename') } }] : [],
  }), 'workspace: rename menu action')
  ctx.effect(() => ctx.contextMenus.register({
    id: 'workspace.delete', target: 'workspace', order: 300,
    resolve: ({ workspaceId, displayTitle }) => ctx.remoteAccess.source('workspace', workspaceId, 'workspace/delete').getSnapshot()
      ? [{ id: 'delete', label: ctx.locale.bind(NS)('delete.workspace'), icon: { key: 'workspace.delete' }, danger: true, separatorBefore: true,
        run: () => { requestWorkspaceAction(workspaceId, displayTitle, 'delete') } }] : [],
  }), 'workspace: delete menu action')
  const browserInjected = (): WorkspaceBrowserInjected & {
    filesNode: WorkspaceFilesNodeService | undefined
  } => ({
    settleWorkspaceAction: () => { workspaceActionRequest.set(null) },
    startSession: (workspaceId, options) => { uiWorkspace.startSession(workspaceId, options) },
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
    hooks: { workspaceActionRequest, contextMenuOpener: ctx.contextMenus.opener, directoryFlow: browserFlowSource, hostInfo,
      workspaceShortcuts: shortcutControls.state, shortcuts: ctx.shortcuts.catalog },
    filesNode: ctx.get('workspaceFilesNode') as WorkspaceFilesNodeService | undefined,
  })
  const pickerInjected = (directoryFlow: HostObservable<boolean>) => (): WorkspacePickerInjected => ({
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow },
  })
  ctx.slots.inject('sidebar.workspaces', () => {
    try {
      return ctx.slots.register(
        {
          name: 'sidebar.workspaces',
          priority: -1,
          children: {
            'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
            'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
            'sidebar.session.row.leading': { kind: 'list', scope: 'root', inline: true },
            'sidebar.session.row.trailing': { kind: 'list', scope: 'root', inline: true },
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
  ctx.slots.inject('contextMenu.content', () => {
    try {
      return ctx.slots.register({
        name: 'contextMenu.content', key: 'session',
        children: { 'sidebar.workspaces.session.menu.item': {
          kind: 'list', scope: 'root', inject: { hooks: { menuOpenState: menuOpenStateFactory, shortcuts: ctx.shortcuts.catalog } },
        } },
      }, SessionMenu)
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-workspace-enhanced: failed to register the contextMenu.content session menu')
      ctx.logger.error(error)
      return []
    }
  })
  registerSessionMenus(ctx, {
    ...pinInjected(), ...archiveInjected(), ...renameInjected(), ...forkInjected(), ...sessionIdInjected(),
    markSession,
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
          name: 'shell.overlay', id: 'workspace.row-toast', inject: rowToastInjected,
          children: { 'workspace.toast': { kind: 'keyed', scope: 'root' } },
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
          inject: pickerInjected(pickerFlowSource),
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
  // The reusable picker depends on no other declaration, so the definition
  // and its directory-flow hole live for this plugin's lifetime -- same as
  // the pristine plugin's own unconditional call, not wrapped in `slots.inject`.
  ctx.slots.registerFactory({
    name: 'workspace.picker',
    scope: 'root',
    children: { 'workspace.picker.directoryFlow': { kind: 'single', scope: 'root' } },
    inject: pickerInjected(factoryFlowSource),
    locale: NS,
  }, WorkspacePickerFactory)
}

function activeSessionRefusal(reason: unknown): readonly SessionActivity[] | undefined {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined
  const { rpcError } = reason as WorkspaceArchiveError
  return rpcError.code === 'workspace/session-active' ? rpcError.details.activity : undefined
}
