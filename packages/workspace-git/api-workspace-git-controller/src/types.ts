/**
 * Wire types for the `workspace-git` Remote namespace.
 * @module dsh-plugins-api-workspace-git-controller/types
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export type { WorkspaceGitStatus } from './git.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No workspace is registered under the requested id. */
    'workspace-git/not-found': { readonly workspaceId: string }
    /** The workspace's own directory is outside any git working tree. */
    'workspace-git/not-a-repository': { readonly path: string }
    /** The underlying git command exited non-zero. */
    'workspace-git/command-failed': { readonly command: string }
  }
}

/**
 * `workspace-git.status` / `workspace-git.commitAll` / `workspace-git.discardAll` /
 * `workspace-git.fetch` / `workspace-git.pullRebase` / `workspace-git.push` request:
 * identifies the workspace whose enclosing git repository is acted on.
 */
export interface WorkspaceGitRequest {
  readonly workspaceId: WorkspaceId
}

/** `workspace-git.commitAll` request: stages and commits every pending change. */
export interface WorkspaceGitCommitAllRequest {
  readonly workspaceId: WorkspaceId
  readonly message: string
}

/** `workspace-git.commitAll` response value. */
export interface WorkspaceGitCommitAllValue {
  readonly committed: true
}

/** `workspace-git.discardAll` response value. */
export interface WorkspaceGitDiscardAllValue {
  readonly discarded: true
}

/**
 * `workspace-git.fetch` response value. Fetching only downloads new commits
 * and updates the workspace's own remote-tracking refs (e.g.
 * `refs/remotes/origin/master`) — unlike `pullRebase`, it never rebases,
 * merges, or otherwise touches `HEAD`, the current branch, or the working
 * tree, so a successful fetch alone never changes {@link
 * WorkspaceGitStatus.files}. It exists to make {@link
 * WorkspaceGitStatus.ahead}/{@link WorkspaceGitStatus.behind} accurate: both
 * are computed from already-known local refs, which only reflect the real
 * remote as of the last fetch/pull/push.
 */
export interface WorkspaceGitFetchValue {
  readonly fetched: true
}

/** `workspace-git.pullRebase` response value. */
export interface WorkspaceGitPullRebaseValue {
  readonly pulled: true
}

/** `workspace-git.push` response value. */
export interface WorkspaceGitPushValue {
  readonly pushed: true
}
