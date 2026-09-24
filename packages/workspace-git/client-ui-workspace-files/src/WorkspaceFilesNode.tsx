/**
 * Resolves the `workspaceFilesNode` service's `Component`: closes real
 * `ctx.remote['workspace-files']`/`ctx.remote['workspace-git']` Remote calls
 * and the bound `workspace-files` locale translate function over `FilesNode`'s
 * existing callback-prop interface, so `FilesNode` itself stays an
 * unmodified, near-verbatim port. `openPath` calls `session.openWorkspacePath`
 * directly — a pristine Host Remote method (`packages/api/session-
 * controller`), but one no pristine `dsh-client-ui-workspace` code calls
 * today; this package is its first Client-side caller, not a reuse of
 * existing wiring. `openFileInSession` reads the optional
 * `conversationFileOpener` service, provided by
 * `dsh-plugins-client-ui-conversation-enhanced` (an out-of-tree replacement
 * for `dsh-client-ui-conversation`'s own row, not pristine prior art — see
 * `../../../ARCHITECTURE.md`'s "File tab: a pristine slot, but a fork-only
 * trigger"); it returns `false` (falling back to the in-app preview modal)
 * only when that package isn't composed in, or when no session is current.
 * @module dsh-plugins-client-ui-workspace-files/WorkspaceFilesNode
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceDirectoryWatchFrame } from 'dsh-plugins-api-workspace-file-controller/types'
// Type-only: pulls the conversationFileOpener optional-service Context merge.
import type {} from 'dsh-plugins-client-ui-conversation-enhanced/client'
import { FilesNode } from './FilesNode.tsx'
import type { FilesNodeProps } from './FilesNode.tsx'
import type { WorkspaceFilesNodeProps, WorkspaceFilesNodeService } from './service.ts'
import type { FilesReveal } from './reveal.ts'
import { WORKSPACE_FILES_NS } from './locale-ns.ts'

/** Unwrap a generated Remote call's result, rejecting with its typed `RemoteError` on failure — restores throw semantics for `FilesNode`'s Promise-based callback props. */
async function unwrap<T>(promise: Promise<RemoteResult<T>>): Promise<T> {
  const result = await promise
  if (result.ok) return result.value
  throw result.error
}

/**
 * Build the `workspaceFilesNode` service for one Client Context.
 * @param ctx - Client root Context (its `remote`/`locale` services back every closure below).
 * @param reveal - the `workspace.files` command's broadcast, when that command is registered.
 * @returns the service the upstream-ready `WorkspaceBrowser` diff resolves through `ctx.get('workspaceFilesNode')`.
 */
export function createWorkspaceFilesNodeService(ctx: Context, reveal?: FilesReveal): WorkspaceFilesNodeService {
  const t = ctx.locale.bind(WORKSPACE_FILES_NS)
  // Defined once per service (not per render): each closes only over `ctx`,
  // never over the adapter's own props, so identity survives every re-render
  // of `WorkspaceFilesNodeAdapter`. `FilesNode`'s `useLevel`/`useGitStatus`
  // effects key on these callbacks' identity — an inline definition here
  // would hand them a fresh function on every render (including the
  // frequent re-renders a running session drives further up the Workspace
  // browser tree), re-triggering the fetch and flashing the expanded level
  // back to its loading state on every tick.
  const listWorkspaceEntries: FilesNodeProps['listWorkspaceEntries'] = (id, path, signal) =>
    unwrap(ctx.remote['workspace-files'].listEntries({ workspaceId: id, path }, signal))
  const watchWorkspaceDirectory: FilesNodeProps['watchWorkspaceDirectory'] = async function* (id, path, signal) {
    // `$stream` is the supervised carrier every Remote stream rides: it owns
    // reconnection and disposal, and `accept()` on the opening frame is how
    // a supervised stream reports that its generation started cleanly (the
    // same handshake `dsh-client-ui-sidebar-files` performs for the
    // Session-scoped `workspaceFiles.changes` watch).
    const stream = ctx.remote.$stream<WorkspaceDirectoryWatchFrame>({
      name: `workspace directory ${path}`,
      open: lifetime => ctx.remote['workspace-files'].watchDirectory({ workspaceId: id, path }, lifetime),
      ended: () => new Error(`Directory watch ended: ${path}`),
    })
    const abort = (): void => { void stream.dispose() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for await (const item of stream) {
        if (signal.aborted) return
        if (item.value.kind === 'ready') item.accept()
        yield item.value.kind
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await stream.dispose()
    }
  }
  const readWorkspaceFile: FilesNodeProps['readWorkspaceFile'] = (id, path, signal) =>
    unwrap(ctx.remote['workspace-files'].readFile({ workspaceId: id, path }, signal))
  const listWorkspaceGitStatus: FilesNodeProps['listWorkspaceGitStatus'] = (id, signal) =>
    unwrap(ctx.remote['workspace-git'].status({ workspaceId: id }, signal))
  const createWorkspaceFile: FilesNodeProps['createWorkspaceFile'] = (id, parentPath, name, signal) =>
    unwrap(ctx.remote['workspace-files'].createFile({ workspaceId: id, parentPath, name }, signal))
      .then(value => value.path)
  const createWorkspaceFolder: FilesNodeProps['createWorkspaceFolder'] = (id, parentPath, name, signal) =>
    unwrap(ctx.remote['workspace-files'].createDirectory({ workspaceId: id, parentPath, name }, signal))
      .then(value => value.path)
  const commitAllChanges: FilesNodeProps['commitAllChanges'] = (id, message, signal) =>
    unwrap(ctx.remote['workspace-git'].commitAll({ workspaceId: id, message }, signal)).then(() => undefined)
  const discardAllChanges: FilesNodeProps['discardAllChanges'] = (id, signal) =>
    unwrap(ctx.remote['workspace-git'].discardAll({ workspaceId: id }, signal)).then(() => undefined)
  const fetchRemote: FilesNodeProps['fetchRemote'] = (id, signal) =>
    unwrap(ctx.remote['workspace-git'].fetch({ workspaceId: id }, signal)).then(() => undefined)
  const pullRebase: FilesNodeProps['pullRebase'] = (id, signal) =>
    unwrap(ctx.remote['workspace-git'].pullRebase({ workspaceId: id }, signal)).then(() => undefined)
  const push: FilesNodeProps['push'] = (id, signal) =>
    unwrap(ctx.remote['workspace-git'].push({ workspaceId: id }, signal)).then(() => undefined)
  const openPath: FilesNodeProps['openPath'] = path =>
    unwrap(ctx.remote.session.openWorkspacePath({ path }, undefined)).then(() => undefined)
  const openFileInSession: FilesNodeProps['openFileInSession'] = (sessionId, workspaceIdArg, path) =>
    ctx.get('conversationFileOpener')?.openFile(sessionId, path, workspaceIdArg) ?? false
  function WorkspaceFilesNodeAdapter({ workspaceId, rootPath, currentSessionId }: WorkspaceFilesNodeProps) {
    return (
      <FilesNode
        workspaceId={workspaceId}
        rootPath={rootPath}
        listWorkspaceEntries={listWorkspaceEntries}
        watchWorkspaceDirectory={watchWorkspaceDirectory}
        readWorkspaceFile={readWorkspaceFile}
        listWorkspaceGitStatus={listWorkspaceGitStatus}
        createWorkspaceFile={createWorkspaceFile}
        createWorkspaceFolder={createWorkspaceFolder}
        commitAllChanges={commitAllChanges}
        discardAllChanges={discardAllChanges}
        fetchRemote={fetchRemote}
        pullRebase={pullRebase}
        push={push}
        openPath={openPath}
        currentSessionId={currentSessionId}
        openFileInSession={openFileInSession}
        reveal={reveal}
        t={t}
      />
    )
  }
  return { Component: WorkspaceFilesNodeAdapter }
}
