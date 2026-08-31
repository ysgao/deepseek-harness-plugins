/**
 * Host owner of the `workspace-files` Remote namespace: Files-tree
 * directory listing, bounded file reads, version-guarded writes, file/folder
 * creation, and one file's HEAD-vs-working-tree diff, all rooted under a
 * workspace's own directory. Mounted as an independent top-level plugin —
 * no edit to `@deepseek-ai/dsh-api-workspace-controller`, whose own
 * `workspace` namespace owns workspace lifecycle, not file browsing.
 *
 * @module dsh-plugins-api-workspace-file-controller/controller
 */

import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { requireWorkspacePath, workspaceFileAtHead } from 'dsh-plugins-api-workspace-git-controller'
import {
  createWorkspaceDirectory, createWorkspaceFile, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_READ_BYTES, isWithinWorkspace,
  listWorkspaceEntries, readWorkspaceFile, resolveWorkspacePath, WorkspaceFileError, writeWorkspaceFile,
} from './files.ts'
import type { WorkspaceEntryListing, WorkspaceFileContent } from './files.ts'
import type {
  WorkspaceCreateDirectoryValue,
  WorkspaceCreateEntryRequest,
  WorkspaceCreateFileValue,
  WorkspaceFileDiff,
  WorkspaceGitFileDiffRequest,
  WorkspaceListEntriesRequest,
  WorkspaceReadFileRequest,
  WorkspaceWriteFileRequest,
  WorkspaceWriteFileValue,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspace-files` Remote namespace. */
    workspaceFileController: WorkspaceFileController
  }
}

/** Workspace file-tree deployment policy. */
export interface Config {
  /** Maximum entries listed per Files-tree directory level before truncation. */
  readonly maxEntries?: number
  /** Maximum bytes read or written for one file. */
  readonly maxReadBytes?: number
}

/** A single non-blank path segment: non-blank, not `.`/`..`, no path separator. */
function isValidEntryName(name: string): boolean {
  return name.trim() !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name)
}

function mapFileError(error: unknown): never {
  if (error instanceof WorkspaceFileError) {
    if (error.code === 'file-too-large') {
      /* v8 ignore next -- WorkspaceFileError's own contract guarantees maxBytes for this code. */
      throw new RemoteError('workspace-files/file-too-large', error.message, { path: error.path, maxBytes: error.maxBytes ?? 0 })
    }
    if (error.code === 'file-changed') {
      throw new RemoteError('workspace-files/file-changed', error.message, { path: error.path })
    }
    if (error.code === 'already-exists') {
      throw new RemoteError('workspace-files/already-exists', error.message, { path: error.path })
    }
    if (error.code === 'parent-missing') {
      throw new RemoteError('workspace-files/parent-missing', error.message, { path: error.path })
    }
    throw new RemoteError('workspace-files/directory-unreadable', error.message, { path: error.path })
  }
  throw error
}

/**
 * Host service backing the generated `ctx.remote['workspace-files']` namespace.
 */
export class WorkspaceFileController extends TypertRemoteService {
  static inject = ['workspaceRegistry']

  static Config: z<Config> = z.object({
    maxEntries: z.natural().default(DEFAULT_MAX_ENTRIES),
    maxReadBytes: z.natural().default(DEFAULT_MAX_READ_BYTES),
  })

  private readonly maxEntries: number | undefined
  private readonly maxReadBytes: number | undefined

  /**
   * @param ctx - Host context carrying the Workspace registry.
   * @param config - Files-tree listing and read/write byte bounds.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workspaceFileController', { namespace: 'workspace-files' })
    this.maxEntries = config.maxEntries
    this.maxReadBytes = config.maxReadBytes
  }

  /**
   * Lists one directory level under a workspace root.
   * @param request - workspace identity and target directory.
   * @param signal - caller lifetime; abort stops the scan.
   * @returns the level's entries and truncation flag.
   */
  @Remote('listEntries')
  listEntries(request: WorkspaceListEntriesRequest, signal: AbortSignal): Promise<WorkspaceEntryListing> {
    const path = this.requireContainedPath(request.workspaceId, request.path)
    return listWorkspaceEntries(path, this.maxEntries, signal).catch(mapFileError)
  }

  /**
   * Reads one regular file under a workspace root for in-app preview.
   * @param request - workspace identity and target file.
   * @param signal - caller lifetime; abort stops the read.
   * @returns the decoded content.
   */
  @Remote('readFile')
  readFile(request: WorkspaceReadFileRequest, signal: AbortSignal): Promise<WorkspaceFileContent> {
    const path = this.requireContainedPath(request.workspaceId, request.path)
    return readWorkspaceFile(path, this.maxReadBytes, signal).catch(mapFileError)
  }

  /**
   * Overwrites one existing regular file under a workspace root, guarded by
   * `expectedVersion` against a concurrent change.
   * @param request - workspace identity, target file, new content, and expected version.
   * @param signal - caller lifetime; abort rejects before publication.
   * @returns the version the write produced.
   */
  @Remote('writeFile')
  async writeFile(request: WorkspaceWriteFileRequest, signal: AbortSignal): Promise<WorkspaceWriteFileValue> {
    const path = this.requireContainedPath(request.workspaceId, request.path)
    const version = await writeWorkspaceFile(path, request.content, request.expectedVersion, this.maxReadBytes, signal)
      .catch(mapFileError)
    return { version }
  }

  /**
   * Creates one new, empty regular file as a child of `parentPath` under a
   * workspace root — the Files tree's "Add file" action.
   * @param request - workspace identity, target parent directory, and new file's name.
   * @param signal - caller lifetime; abort rejects before creation.
   * @returns the created file's absolute path and initial content version.
   */
  @Remote('createFile')
  async createFile(request: WorkspaceCreateEntryRequest, signal: AbortSignal): Promise<WorkspaceCreateFileValue> {
    const path = this.requireContainedChildPath(request)
    const version = await createWorkspaceFile(path, signal).catch(mapFileError)
    return { path, version }
  }

  /**
   * Creates one new, empty directory as a child of `parentPath` under a
   * workspace root — the Files tree's "Add folder" action.
   * @param request - workspace identity, target parent directory, and new directory's name.
   * @param signal - caller lifetime; abort rejects before creation.
   * @returns the created directory's absolute path.
   */
  @Remote('createDirectory')
  async createDirectory(request: WorkspaceCreateEntryRequest, signal: AbortSignal): Promise<WorkspaceCreateDirectoryValue> {
    const path = this.requireContainedChildPath(request)
    await createWorkspaceDirectory(path, signal).catch(mapFileError)
    return { path }
  }

  /**
   * Reads one file's `HEAD` and current working-tree text, for a side-by-side diff.
   * @param request - workspace identity and target file.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns the file's `HEAD` and working-tree text.
   */
  @Remote('gitFileDiff')
  async gitFileDiff(request: WorkspaceGitFileDiffRequest, signal: AbortSignal): Promise<WorkspaceFileDiff> {
    const workspacePath = requireWorkspacePath(this.ctx, request.workspaceId)
    const path = this.requireContainedPath(request.workspaceId, request.path)
    const oldText = await workspaceFileAtHead(workspacePath, path, signal)
    let newText: string | null
    try {
      const content = await readWorkspaceFile(path, this.maxReadBytes, signal)
      // A binary working-tree read has no text diff to show; the client only
      // offers the diff toggle for a text-kind file, so this folds the same
      // as "absent" here rather than earning its own wire state.
      newText = content.kind === 'text' ? content.content : null
    } catch (error) {
      if (error instanceof WorkspaceFileError && error.code === 'directory-unreadable') {
        newText = null // deleted from the working tree since the last git operation.
      } else {
        mapFileError(error)
      }
    }
    return { oldText, newText }
  }

  private requireContainedPath(workspaceId: WorkspaceCreateEntryRequest['workspaceId'], requestedPath: string): string {
    const root = requireWorkspacePath(this.ctx, workspaceId)
    const path = resolveWorkspacePath(requestedPath)
    if (!isWithinWorkspace(root, path)) {
      throw new RemoteError('workspace-files/outside-workspace', `"${requestedPath}" is outside workspace "${workspaceId}"`, { path: requestedPath })
    }
    return path
  }

  /** Validate a create request's `name` as one path segment, then join and contain it under `parentPath`. */
  private requireContainedChildPath(request: WorkspaceCreateEntryRequest): string {
    if (!isValidEntryName(request.name)) {
      throw new RemoteError('workspace-files/invalid-name', `"${request.name}" is not a valid file or folder name`, { name: request.name })
    }
    const parent = this.requireContainedPath(request.workspaceId, request.parentPath)
    return join(parent, request.name)
  }
}

export default WorkspaceFileController
