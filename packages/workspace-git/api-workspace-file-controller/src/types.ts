/**
 * Wire types for the `workspace-files` Remote namespace.
 * @module dsh-plugins-api-workspace-file-controller/types
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export type { WorkspaceEntry, WorkspaceEntryListing, WorkspaceFileContent, WorkspaceFileVersion } from './files.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested path is outside the workspace's own directory. */
    'workspace-files/outside-workspace': { readonly path: string }
    /** A create request's `name` is not a single valid path segment. */
    'workspace-files/invalid-name': { readonly name: string }
    /** The target could not be listed, read, or written. */
    'workspace-files/directory-unreadable': { readonly path: string }
    /** A read or write exceeded the configured byte bound. */
    'workspace-files/file-too-large': { readonly path: string; readonly maxBytes: number }
    /** The on-disk content changed since it was last read. */
    'workspace-files/file-changed': { readonly path: string }
    /** The create target already exists. */
    'workspace-files/already-exists': { readonly path: string }
    /** The create target's enclosing directory does not exist. */
    'workspace-files/parent-missing': { readonly path: string }
    /** `gitFileDiff`'s workspace directory is outside any git working tree. */
    'workspace-files/not-a-repository': { readonly path: string }
    /** The filesystem cannot initialize a watch for this directory. */
    'workspace-files/watch-unsupported': { readonly path: string }
  }
}

/** `workspace-files.listEntries` request: one directory level under a workspace root. */
export interface WorkspaceListEntriesRequest {
  readonly workspaceId: WorkspaceId
  readonly path: string
}

/** `workspace-files.readFile` request: one regular file under a workspace root. */
export interface WorkspaceReadFileRequest {
  readonly workspaceId: WorkspaceId
  readonly path: string
}

/** `workspace-files.writeFile` request: an atomic, version-guarded overwrite of one regular file under a workspace root. */
export interface WorkspaceWriteFileRequest {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly content: string
  readonly expectedVersion: import('./files.ts').WorkspaceFileVersion
}

/** `workspace-files.writeFile` response value: the version the write produced. */
export interface WorkspaceWriteFileValue {
  readonly version: import('./files.ts').WorkspaceFileVersion
}

/**
 * `workspace-files.createFile` / `workspace-files.createDirectory` request: one
 * new child of `parentPath` (an existing directory under the workspace root)
 * named `name` — a single non-blank path segment, never a multi-segment
 * path, so the caller cannot escape `parentPath` through the name field.
 */
export interface WorkspaceCreateEntryRequest {
  readonly workspaceId: WorkspaceId
  readonly parentPath: string
  readonly name: string
}

/** `workspace-files.createFile` response value: the created empty file's absolute path and initial content version. */
export interface WorkspaceCreateFileValue {
  readonly path: string
  readonly version: import('./files.ts').WorkspaceFileVersion
}

/** `workspace-files.createDirectory` response value: the created directory's absolute path. */
export interface WorkspaceCreateDirectoryValue {
  readonly path: string
}

/**
 * `workspace-files.watchDirectory` request: one directory level under a
 * workspace root, observed for as long as the caller's stream lives.
 *
 * Workspace-scoped, not Session-scoped, which is the whole reason this
 * namespace carries a watch at all when `@deepseek-ai/dsh-api-workspace-
 * files` already has `changes`: that one resolves its root from a Session
 * identity on the wire, so it cannot answer for a Workspace the user has
 * selected but started no Session in — precisely the state the left
 * Sidebar's Files tree is in every time it opens a new Workspace.
 */
export interface WorkspaceWatchDirectoryRequest {
  readonly workspaceId: WorkspaceId
  readonly path: string
}

/**
 * One `workspace-files.watchDirectory` frame: the watch became active, or
 * the directory changed and its listing is stale.
 *
 * Deliberately carries no change detail. The tree re-lists the level it
 * already knows how to list, so naming the entry that moved would be a
 * second, racier source of truth for the same fact.
 */
export type WorkspaceDirectoryWatchFrame =
  | { readonly kind: 'ready' }
  | { readonly kind: 'change' }

/** `workspace-files.gitFileDiff` request: one file's `HEAD` vs. working-tree text under a workspace root. */
export interface WorkspaceGitFileDiffRequest {
  readonly workspaceId: WorkspaceId
  readonly path: string
}

/** `workspace-files.gitFileDiff` response value: one file's `HEAD` and working-tree text, for a side-by-side diff. */
export interface WorkspaceFileDiff {
  /** Content at `HEAD`, or `null` when the file has no committed blob at this path (new, untracked, or renamed from elsewhere). */
  readonly oldText: string | null
  /** Current working-tree content, or `null` when the file no longer exists on disk (deleted). */
  readonly newText: string | null
}
