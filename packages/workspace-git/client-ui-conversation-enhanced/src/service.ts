/**
 * The optional `conversationFileOpener` Context service: lets any
 * out-of-tree Client package (the sidebar Files tree,
 * `dsh-plugins-client-ui-workspace-files`) dock a file into a session's
 * File tab without depending on this package — `ctx.get('conversationFileOpener')`,
 * `undefined` when this package isn't composed in, following this
 * codebase's own standing convention for optional cross-package services
 * (`packages/AGENTS.md`: "Optional services use `ctx.get(name)`"). Works
 * even before `sessionId`'s first turn: queuing a request also marks that
 * session's sticky `everOpenedFile` bit (`./FileOpenRegistry.ts`), which the
 * forked `ConversationRoot`/`ConversationSessionHeader`/`ConversationSession`
 * (`./ConversationRoot.tsx`, `./ConversationSession.tsx`) read to stay out
 * of `dsh-client-ui-conversation`'s pristine blank/Hero gate. See `./apply.ts`
 * for the implementation.
 * @module dsh-plugins-client-ui-conversation-enhanced/service
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** What the `conversationFileOpener` optional service provides. */
export interface ConversationFileOpener {
  /**
   * Request that `sessionId`'s File tab show `path`, even if `sessionId` has
   * never had a first turn.
   * @param sessionId - target session (need not be the current one).
   * @param path - workspace-relative file path to open.
   * @param workspaceId - the opener's own resolved workspace, when it has
   * one, so the File tab reads the exact workspace the opener meant even if
   * the session's own binding later changes.
   * @returns whether the request was queued — `false` when `sessionId`
   * resolves no session binding, or when no `conversation.view` entry
   * registers the `file` id (this package installed, but the File tab
   * package, `dsh-plugins-client-ui-conversation-files`, didn't). The caller
   * should fall back to its own presentation in either `false` case.
   */
  openFile(sessionId: SessionId, path: string, workspaceId: WorkspaceId | undefined): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional: present only when this package is composed in. */
    conversationFileOpener?: ConversationFileOpener
  }
}
