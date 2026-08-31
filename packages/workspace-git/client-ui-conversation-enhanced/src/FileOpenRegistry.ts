/**
 * Cross-session file-open request queue: the mechanism the
 * `conversationFileOpener` service and the forked `ConversationSession`
 * component share to hand a file-open request across the React boundary
 * between the sidebar Files tree (any session) and the Session body slot
 * (only the currently mounted session). See `../ARCHITECTURE.md`'s "File
 * tab: a pristine slot, but a fork-only trigger" for why no pristine
 * mechanism reaches a live per-session store instance from outside its own
 * render tree.
 * @module dsh-plugins-client-ui-conversation-enhanced/FileOpenRegistry
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** One pending file-open request addressed to a session. */
export interface PendingFileOpen {
  readonly path: string
  readonly workspaceId: WorkspaceId | undefined
}

/**
 * Per-session pending-request queue. At most one request lives per session
 * at a time — a second request for the same session before the first
 * drains simply replaces it (the opener's own intent: show this path now).
 */
export class FileOpenRegistry {
  private readonly pending = new Map<SessionId, PendingFileOpen>()
  private readonly listeners = new Map<SessionId, Set<() => void>>()

  /** Queue a request for `sessionId`, replacing any undrained one. */
  request(sessionId: SessionId, path: string, workspaceId: WorkspaceId | undefined): void {
    this.pending.set(sessionId, { path, workspaceId })
    this.notify(sessionId)
  }

  /** Drop the pending request for `sessionId`, once its owning component has read it. */
  complete(sessionId: SessionId): void {
    if (!this.pending.delete(sessionId)) return
    this.notify(sessionId)
  }

  /** An `ObservableSnapshot` scoped to one session's own pending request. */
  hookFor(sessionId: SessionId): ObservableSnapshot<PendingFileOpen | undefined> {
    return {
      getSnapshot: () => this.pending.get(sessionId),
      subscribe: (fn) => {
        let set = this.listeners.get(sessionId)
        if (set === undefined) {
          set = new Set()
          this.listeners.set(sessionId, set)
        }
        set.add(fn)
        return () => {
          set.delete(fn)
          if (set.size === 0) this.listeners.delete(sessionId)
        }
      },
    }
  }

  private notify(sessionId: SessionId): void {
    for (const fn of this.listeners.get(sessionId) ?? []) fn()
  }
}
