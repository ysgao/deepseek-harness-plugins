/**
 * Host Typert controller for workspace git status/commit/discard/fetch
 * /pull-rebase/push, mounted as an independent top-level plugin. See
 * ../../../ARCHITECTURE.md.
 *
 * @module dsh-plugins-api-workspace-git-controller
 */
export { requireWorkspacePath, WorkspaceGitController } from './controller.ts'
export { default } from './controller.ts'
export {
  commitAllChanges, discardAllChanges, fetchRemote, GitCommandError, GitNotARepositoryError, pullRebase, push,
  workspaceFileAtHead, workspaceGitStatus,
} from './git.ts'
export type { WorkspaceGitStatus } from './git.ts'
export type * from './types.ts'
