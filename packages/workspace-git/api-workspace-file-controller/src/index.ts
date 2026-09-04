/**
 * Host Typert controller for workspace file list/read/write/create/diff,
 * mounted as an independent top-level plugin. See ../../../ARCHITECTURE.md.
 *
 * @module dsh-plugins-api-workspace-file-controller
 */
export { WorkspaceFileController } from './controller.ts'
export { default } from './controller.ts'
export type { Config } from './controller.ts'
export {
  createWorkspaceDirectory, createWorkspaceFile, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_READ_BYTES, isReallyWithinWorkspace,
  isWithinWorkspace, listWorkspaceEntries, mediaTypeFor, readWorkspaceFile, resolveWorkspacePath, WorkspaceFileError,
  writeWorkspaceFile,
} from './files.ts'
export type { WorkspaceEntry, WorkspaceEntryListing, WorkspaceFileContent, WorkspaceFileVersion } from './files.ts'
export type * from './types.ts'
