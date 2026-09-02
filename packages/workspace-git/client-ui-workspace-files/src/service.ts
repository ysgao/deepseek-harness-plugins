/**
 * The optional `workspaceFilesNode` Context service: lets `dsh-client-ui-
 * workspace`'s `WorkspaceBrowser` render a Files sibling row for a real
 * Workspace group without depending on this out-of-tree package —
 * `ctx.get('workspaceFilesNode')`, `undefined` when the providing plugin
 * isn't composed in, following this codebase's own standing convention for
 * optional cross-package services (`packages/AGENTS.md`: "Optional services
 * use `ctx.get(name)`"). `dsh-client-ui-conversation`'s `conversationFileOpener`
 * is the same shape of seam; it's now provided by
 * `dsh-plugins-client-ui-conversation-enhanced`, an out-of-tree replacement
 * for that package's own row (see `../../../ARCHITECTURE.md`'s "File tab: a
 * pristine slot, but a fork-only trigger"), not pristine prior art.
 *
 * `dsh-plugins-client-ui-workspace-enhanced` resolves this service once and
 * renders `Component` in the same row `FilesNode` occupied in the fork —
 * sibling to the Session rows, the selected Workspace's own directory as
 * its implicit root, no extra click (see that package's own
 * `WorkspaceBrowser.tsx`, and `../../../ARCHITECTURE.md`'s "Replace, don't
 * patch"). This service declaration is this package's own permanent seam,
 * not a stand-in for a future vendor change — `dsh-client-ui-workspace`
 * itself never needs to know this package exists.
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
