/**
 * Resolves the `workspaceFilesNode` service's `Component`: closes real
 * `ctx.remote['workspace-files']`/`ctx.remote['workspace-git']` Remote calls
 * and the bound `workspace-files` locale translate function over `FilesNode`'s
 * existing callback-prop interface, so `FilesNode` itself stays an
 * unmodified, near-verbatim port. `openPath` reuses the same pristine
 * `session.openWorkspacePath` Remote method `dsh-client-ui-workspace`'s own
 * plugin already calls; `openFileInSession` reads the same optional
 * `conversationFileOpener` service that plugin already reads, so this
 * package upgrades automatically once the File tab package (Task 20) is
 * composed in, and degrades to the in-app preview modal until then.
 * @module dsh-plugins-client-ui-workspace-files/WorkspaceFilesNode
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the conversationFileOpener optional-service Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FilesNode } from './FilesNode.tsx'
import type { WorkspaceFilesNodeProps, WorkspaceFilesNodeService } from './service.ts'
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
 * @returns the service the upstream-ready `WorkspaceBrowser` diff resolves through `ctx.get('workspaceFilesNode')`.
 */
export function createWorkspaceFilesNodeService(ctx: Context): WorkspaceFilesNodeService {
  const t = ctx.locale.bind(WORKSPACE_FILES_NS)
  function WorkspaceFilesNodeAdapter({ workspaceId, rootPath, currentSessionId }: WorkspaceFilesNodeProps) {
    return (
      <FilesNode
        workspaceId={workspaceId}
        rootPath={rootPath}
        listWorkspaceEntries={(id, path, signal) =>
          unwrap(ctx.remote['workspace-files'].listEntries({ workspaceId: id, path }, signal))}
        readWorkspaceFile={(id, path, signal) =>
          unwrap(ctx.remote['workspace-files'].readFile({ workspaceId: id, path }, signal))}
        listWorkspaceGitStatus={(id, signal) =>
          unwrap(ctx.remote['workspace-git'].status({ workspaceId: id }, signal))}
        createWorkspaceFile={(id, parentPath, name, signal) =>
          unwrap(ctx.remote['workspace-files'].createFile({ workspaceId: id, parentPath, name }, signal))
            .then(value => value.path)}
        createWorkspaceFolder={(id, parentPath, name, signal) =>
          unwrap(ctx.remote['workspace-files'].createDirectory({ workspaceId: id, parentPath, name }, signal))
            .then(value => value.path)}
        commitAllChanges={(id, message, signal) =>
          unwrap(ctx.remote['workspace-git'].commitAll({ workspaceId: id, message }, signal)).then(() => undefined)}
        discardAllChanges={(id, signal) =>
          unwrap(ctx.remote['workspace-git'].discardAll({ workspaceId: id }, signal)).then(() => undefined)}
        fetchRemote={(id, signal) =>
          unwrap(ctx.remote['workspace-git'].fetch({ workspaceId: id }, signal)).then(() => undefined)}
        pullRebase={(id, signal) =>
          unwrap(ctx.remote['workspace-git'].pullRebase({ workspaceId: id }, signal)).then(() => undefined)}
        push={(id, signal) =>
          unwrap(ctx.remote['workspace-git'].push({ workspaceId: id }, signal)).then(() => undefined)}
        openPath={path => unwrap(ctx.remote.session.openWorkspacePath({ path }, undefined)).then(() => undefined)}
        currentSessionId={currentSessionId}
        openFileInSession={(sessionId, workspaceIdArg, path) =>
          ctx.get('conversationFileOpener')?.openFile(sessionId, path, workspaceIdArg) ?? false}
        t={t}
      />
    )
  }
  return { Component: WorkspaceFilesNodeAdapter }
}
