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
import { FileView, type FileViewInjected } from './FileView.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'conversation-files'

/** Services required by the File view. */
export const inject = ['slots', 'locale', 'remote']

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
    inject: (sessionId: SessionId): FileViewInjected => ({
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
      tFiles,
    }),
  }, FileView))
}
