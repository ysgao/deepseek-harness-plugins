/**
 * Host owner of the `workspace-git` Remote namespace: git status and the
 * commit/discard/fetch/pull-rebase/push write actions, scanned or applied
 * against the git repository enclosing a workspace's own directory. Mounted
 * as an independent top-level plugin — no edit to
 * `@deepseek-ai/dsh-api-workspace-controller`, whose own `workspace`
 * namespace owns workspace lifecycle (create/rename/delete) and the Files
 * tree's read side, not git.
 *
 * @module dsh-plugins-api-workspace-git-controller/controller
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  commitAllChanges, discardAllChanges, fetchRemote, GitCommandError, GitNotARepositoryError, pullRebase, push,
  workspaceGitStatus,
} from './git.ts'
import type { WorkspaceGitStatus } from './git.ts'
import type {
  WorkspaceGitCommitAllRequest,
  WorkspaceGitCommitAllValue,
  WorkspaceGitDiscardAllValue,
  WorkspaceGitFetchValue,
  WorkspaceGitPullRebaseValue,
  WorkspaceGitPushValue,
  WorkspaceGitRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspace-git` Remote namespace. */
    workspaceGitController: WorkspaceGitController
  }
}

/**
 * Resolve a workspace id to its canonical directory path.
 * @param ctx - Host context carrying the Workspace registry.
 * @param workspaceId - the workspace identity to resolve.
 * @returns the workspace's canonical directory path.
 * @throws RemoteError `workspace-git/not-found` when no workspace is registered under `workspaceId`.
 */
export function requireWorkspacePath(ctx: Context, workspaceId: WorkspaceId): string {
  const workspace = ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
  if (workspace === undefined) {
    throw new RemoteError('workspace-git/not-found', `Workspace "${workspaceId}" not found`, { workspaceId })
  }
  return workspace.path
}

function mapGitError(error: unknown): never {
  if (error instanceof GitNotARepositoryError) {
    throw new RemoteError('workspace-git/not-a-repository', error.message, { path: error.path })
  }
  if (error instanceof GitCommandError) {
    throw new RemoteError('workspace-git/command-failed', error.message, { command: error.command })
  }
  throw error
}

/**
 * Host service backing the generated `ctx.remote['workspace-git']` namespace.
 */
export class WorkspaceGitController extends TypertRemoteService {
  static inject = ['workspaceRegistry']

  /** @param ctx - Host context carrying the Workspace registry. */
  constructor(ctx: Context) {
    super(ctx, 'workspaceGitController', { namespace: 'workspace-git' })
  }

  /**
   * Reports the current branch and pending file changes of the git
   * repository enclosing a workspace's own directory.
   * @param request - workspace identity.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns the workspace's git status.
   */
  @Remote('status')
  status(request: WorkspaceGitRequest, signal: AbortSignal): Promise<WorkspaceGitStatus> {
    const path = requireWorkspacePath(this.ctx, request.workspaceId)
    return workspaceGitStatus(path, signal)
  }

  /**
   * Stages every pending change and commits them.
   * @param request - workspace identity and commit message.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns commit confirmation.
   * @throws RemoteError `gateway/bad-request` when the commit message is blank.
   */
  @Remote('commitAll')
  async commitAll(request: WorkspaceGitCommitAllRequest, signal: AbortSignal): Promise<WorkspaceGitCommitAllValue> {
    const message = request.message.trim()
    if (message === '') {
      throw new RemoteError('gateway/bad-request', 'a commit message must be non-blank', {})
    }
    const path = requireWorkspacePath(this.ctx, request.workspaceId)
    await commitAllChanges(path, message, signal).catch(mapGitError)
    return { committed: true }
  }

  /**
   * Reverts every tracked file's pending change to its `HEAD` content.
   * @param request - workspace identity.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns discard confirmation.
   */
  @Remote('discardAll')
  async discardAll(request: WorkspaceGitRequest, signal: AbortSignal): Promise<WorkspaceGitDiscardAllValue> {
    const path = requireWorkspacePath(this.ctx, request.workspaceId)
    await discardAllChanges(path, signal).catch(mapGitError)
    return { discarded: true }
  }

  /**
   * Downloads new commits and updates the workspace's remote-tracking refs,
   * without touching the current branch or working tree.
   * @param request - workspace identity.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns fetch confirmation.
   */
  @Remote('fetch')
  async fetch(request: WorkspaceGitRequest, signal: AbortSignal): Promise<WorkspaceGitFetchValue> {
    const path = requireWorkspacePath(this.ctx, request.workspaceId)
    await fetchRemote(path, signal).catch(mapGitError)
    return { fetched: true }
  }

  /**
   * Rebases local commits onto the current branch's already-known upstream,
   * without fetching first (pair with `fetch` for the rebase to include the
   * remote's very latest commits).
   * @param request - workspace identity.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns pull confirmation.
   */
  @Remote('pullRebase')
  async pullRebase(request: WorkspaceGitRequest, signal: AbortSignal): Promise<WorkspaceGitPullRebaseValue> {
    const path = requireWorkspacePath(this.ctx, request.workspaceId)
    await pullRebase(path, signal).catch(mapGitError)
    return { pulled: true }
  }

  /**
   * Pushes the current branch to its configured remote.
   * @param request - workspace identity.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns push confirmation.
   */
  @Remote('push')
  async push(request: WorkspaceGitRequest, signal: AbortSignal): Promise<WorkspaceGitPushValue> {
    const path = requireWorkspacePath(this.ctx, request.workspaceId)
    await push(path, signal).catch(mapGitError)
    return { pushed: true }
  }
}

export default WorkspaceGitController
