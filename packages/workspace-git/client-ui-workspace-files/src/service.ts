/**
 * The optional `workspaceFilesNode` Context service: lets `dsh-client-ui-
 * workspace`'s `WorkspaceBrowser` render a Files sibling row for a real
 * Workspace group without depending on this out-of-tree package, mirroring
 * `dsh-client-ui-conversation`'s own `conversationFileOpener` optional
 * service (`ctx.get('conversationFileOpener')`, `undefined` when the
 * providing plugin isn't composed in). The upstream-ready diff this plugin
 * pairs with (see ../../../ARCHITECTURE.md Task 19) resolves this service
 * once and renders `Component` in the same row `FilesNode` occupied in
 * yga/deepseek-harness — sibling to the Session rows, the selected
 * Workspace's own directory as its implicit root, no extra click.
 * @module dsh-plugins-client-ui-workspace-files/service
 */
import type { ComponentType } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Props the Files sibling row needs from its owner: identity, not behavior. */
export interface WorkspaceFilesNodeProps {
  workspaceId: WorkspaceId
  /** The Workspace's own canonical root path (the tree's initial level). */
  rootPath: string
  /** The currently selected session, if any (the file-tab open route's target). */
  currentSessionId: SessionId | undefined
}

/** What the `workspaceFilesNode` optional service provides. */
export interface WorkspaceFilesNodeService {
  /** The Files sibling row; every Remote/locale dependency is already closed over. */
  readonly Component: ComponentType<WorkspaceFilesNodeProps>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional: present only when this package is composed in. */
    workspaceFilesNode?: WorkspaceFilesNodeService
  }
}
