/**
 * Registers the File conversation-view tab into the pristine
 * `conversation.view` slot (`dsh-client-ui-conversation`) — the same
 * `kind: 'list'` slot the Chat (`dsh-client-ui-chat`) and Trajectory
 * (`dsh-client-ui-trajectory`) tabs already register into, so this package
 * needs no upstream diff of its own (unlike its sibling
 * `dsh-plugins-client-ui-workspace-files`, whose sidebar mount point has no
 * pristine slot yet). Wire calls go through this repo's own
 * `dsh-plugins-api-workspace-file-controller`/`-git-controller` Typert
 * namespaces, not the fork-extended `dsh-api-workspace-controller` client
 * model the fork's own `ui-conversation-files` called.
 * @module dsh-plugins-client-ui-conversation-files/apply
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the ctx.remote Context merge (ClientRemote).
import type {} from '@deepseek-ai/dsh-api-gateway/client'
// Type-only: pulls the ctx.workspaces Context merge (IWorkspaces, for the
// session -> owning-workspace fallback derivation only — a pristine
// capability, not something this package adds).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls ctx.remote.session (openWorkspacePath).
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
// Type-only: pulls this package's own generated Remote namespace merges.
import type {} from 'dsh-plugins-api-workspace-file-controller/remote'
import type {} from 'dsh-plugins-api-workspace-git-controller/remote'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the 'conversation.view' SlotMap row.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the SlotMap rows the preview engine declares, chiefly
// 'sidebar.right.tab.document.actions' — the toolbar seat the File tab's own
// controls register into below. Types only; nothing from this package is
// imported at runtime, and the engine itself is mounted by
// dsh-plugins-client-ui-document-host, not by this one.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/document/contract.ts'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { fileDocumentTabInfoFactory } from './document-seat.ts'
import { FileActions, type FileActionsProps } from './FileActions.tsx'
import { FileView, type FileViewInjected } from './FileView.tsx'
import { FileModeStores } from './mode-store.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'conversation-files'

/** Services required by the File view. The two specific 'remote.<namespace>'
 * sub-keys are required alongside the generic 'remote': the ctx.remote[...]
 * property proxy is topology-sensitive and only resolves a namespace this
 * fiber's own inject names (see dsh-plugins-client-ui-workspace-enhanced's
 * apply.ts, which mounts both contributions). */
export const inject = ['slots', 'locale', 'remote', 'remote.workspace-files', 'remote.workspace-git']

/** Unwrap a generated Remote call's result, rejecting with its typed `RemoteError` on failure. */
async function unwrap<T>(promise: Promise<RemoteResult<T>>): Promise<T> {
  const result = await promise
  if (result.ok) return result.value
  throw result.error
}

/**
 * Mount the File conversation-view tab.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.locale.register(NS, { zh, en })
  const tFiles = ctx.locale.bind(NS)

  // One toolbar state per session, shared by the two entries below: the File
  // view publishes into it, and the document-toolbar entry reads it back.
  // Held here, in apply(), because both entries resolve their session's store
  // from the same instance — see ./mode-store.ts.
  const modeStores = new FileModeStores()

  // The File tab's own controls, drawn inside the relocated preview engine's
  // header toolbar: upstream declares `sidebar.right.tab.document.actions`
  // for exactly this ("contributions acting on the previewed file"), so the
  // file gets one row of controls rather than the engine's above this tab's.
  //
  // Through `slots.inject`, so a composition without
  // `dsh-plugins-client-ui-document-host` — where nothing declares this slot
  // — simply never mounts it, and `FileView` keeps drawing the controls in
  // its own header. That is the fallback, not a degraded mode.
  ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.document.actions',
    id: 'conversation-files.mode',
    inject: (sessionId: SessionId): Omit<FileActionsProps, 't'> & { t: typeof tFiles } => ({
      store: modeStores.for(sessionId),
      owner: 'engine',
      t: tFiles,
    }),
  }, FileActions))

  // Re-fetched on every call, not cached at apply() time: `workspaces` is an
  // optional cross-package service that may not have registered yet when
  // this plugin's own apply() runs — caching it here would freeze it at
  // `undefined` for the plugin's whole lifetime.
  //
  // `requestedWorkspaceId` comes from the opener (e.g. the Workspace Files
  // tree, which always knows its own workspace) and is used as-is when
  // present. Only a requester with no workspace of its own (e.g. a chat
  // message's file mention, which only has a sessionId) falls back to
  // deriving it from the session's membership in a workspace's roster — a
  // derivation that misses for a session not yet reflected there, unlike the
  // direct id.
  const resolveWorkspaceId = (targetSessionId: SessionId, requestedWorkspaceId: WorkspaceId | undefined): WorkspaceId | undefined => {
    if (requestedWorkspaceId !== undefined) return requestedWorkspaceId
    const workspaces = ctx.get('workspaces')
    if (workspaces === undefined) return undefined
    return workspaces.list.getSnapshot().items
      .find(item => item.sessionIds.includes(targetSessionId))?.workspaceId
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'file',
    order: 5,
    label: () => tFiles('view.file'),
    locale: 'conversation',
    // The document seat: where `dsh-plugins-client-ui-document-host` puts the
    // vendored preview engine's own renderers, so a file previews in the
    // middle of the app instead of the right Sidebar. Declared here because
    // this entry is the parent that draws it, and a slot has exactly one
    // declaring entry. Nothing registering into it is a normal state — the
    // tab then draws its own `FilePreview`, as it always has.
    children: {
      'conversation.file.document': {
        kind: 'single',
        scope: 'session',
        inject: { hooks: { tabInfo: fileDocumentTabInfoFactory } },
      },
    },
    inject: (sessionId: SessionId): FileViewInjected => {
      const modeStore = modeStores.for(sessionId)
      return {
        readFile: (workspaceId, path, signal) => {
          const owner = resolveWorkspaceId(sessionId, workspaceId)
          if (owner === undefined) {
            return Promise.reject(new Error(`dsh-plugins-client-ui-conversation-files: session "${sessionId}" has no owning workspace`))
          }
          return unwrap(ctx.remote['workspace-files'].readFile({ workspaceId: owner, path }, signal))
        },
        openPath: async (path) => {
          await unwrap(ctx.remote.session.openWorkspacePath({ path }, undefined))
        },
        getGitStatus: (workspaceId, signal) => {
          const owner = resolveWorkspaceId(sessionId, workspaceId)
          if (owner === undefined) {
            return Promise.reject(new Error(`dsh-plugins-client-ui-conversation-files: session "${sessionId}" has no owning workspace`))
          }
          return unwrap(ctx.remote['workspace-git'].status({ workspaceId: owner }, signal))
        },
        getFileDiff: (workspaceId, path, signal) => {
          const owner = resolveWorkspaceId(sessionId, workspaceId)
          if (owner === undefined) {
            return Promise.reject(new Error(`dsh-plugins-client-ui-conversation-files: session "${sessionId}" has no owning workspace`))
          }
          return unwrap(ctx.remote['workspace-files'].gitFileDiff({ workspaceId: owner, path }, signal))
        },
        writeFile: (workspaceId, path, content, expectedVersion, signal) => {
          const owner = resolveWorkspaceId(sessionId, workspaceId)
          if (owner === undefined) {
            return Promise.reject(new Error(`dsh-plugins-client-ui-conversation-files: session "${sessionId}" has no owning workspace`))
          }
          return unwrap(ctx.remote['workspace-files'].writeFile({ workspaceId: owner, path, content, expectedVersion }, signal))
            .then(value => value.version)
        },
        // The session the tab is drawn for is the session the address names:
        // a document body reads its file through this address, and the file's
        // workspace is resolved Host-side from that session.
        fileAddress: path => fileAddressFor(sessionId, undefined, path),
        // The same id `fileAddress` above stamps into every address this tab
        // mints, so the tab can refuse one that names a different session.
        sessionId,
        // The same instance the document-toolbar entry above resolves for this
        // session: that is what makes the two mounts one control.
        modeStore,
        // Dropped by identity, so a remount that already replaced this store
        // is not evicted by the old tab's late cleanup.
        releaseModeStore: () => { modeStores.release(sessionId, modeStore) },
        tFiles,
      }
    },
  }, FileView))
}
