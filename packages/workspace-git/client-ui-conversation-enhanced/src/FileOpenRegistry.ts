/**
 * Cross-session file-open request queue: the mechanism the
 * `conversationFileOpener` service and the forked `ConversationRoot`/
 * `ConversationSessionHeader`/`ConversationSession` components share to hand
 * a file-open request across the React boundary between the sidebar Files
 * tree (any session) and the Session's own slots (only the currently
 * mounted session). See `../ARCHITECTURE.md`'s "File tab: a pristine slot,
 * but a fork-only trigger" for why no pristine mechanism reaches a live
 * per-session store instance from outside its own render tree.
 *
 * Also tracks, per session, a second and separate fact: whether a file has
 * EVER been opened there. `dsh-client-ui-conversation`'s pristine Hero gate
 * (`session.blank && conversationPhase(...) === 'blank'`, in `ConversationRoot`,
 * `ConversationSessionHeader`, and `ConversationSession`) hides the header
 * tabs, the view body, and docks the composer in its centered landing style
 * until the session's first turn — a file preview opened before that turn
 * would otherwise land in a hidden view with no visible effect. Unlike the
 * one-shot pending request, this bit is sticky (once true, stays true for
 * the session's lifetime in this registry) so the forked components can
 * treat "this session has shown a file" as equivalent to "this session has
 * engaged" for their own Hero-gating decision, without depending on an
 * actual conversation turn ever happening.
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
 * Per-session pending-request queue, plus the sticky ever-opened set. At
 * most one pending request lives per session at a time — a second request
 * for the same session before the first drains simply replaces it (the
 * opener's own intent: show this path now).
 */
export class FileOpenRegistry {
  private readonly pending = new Map<SessionId, PendingFileOpen>()
  private readonly listeners = new Map<SessionId, Set<() => void>>()
  private readonly everOpened = new Set<SessionId>()
  private readonly everOpenedListeners = new Map<SessionId, Set<() => void>>()
  // Memoized per-session hook objects — see hookFor/hookForEverOpened's own
  // doc comment for why returning a fresh object literal per call is a real
  // bug, not just an allocation nicety.
  private readonly pendingHooks = new Map<SessionId, ObservableSnapshot<PendingFileOpen | undefined>>()
  private readonly everOpenedHooks = new Map<SessionId, ObservableSnapshot<boolean>>()

  /** Queue a request for `sessionId`, replacing any undrained one, and mark it as having ever opened a file. */
  request(sessionId: SessionId, path: string, workspaceId: WorkspaceId | undefined): void {
    this.pending.set(sessionId, { path, workspaceId })
    this.notify(sessionId)
    if (!this.everOpened.has(sessionId)) {
      this.everOpened.add(sessionId)
      this.notifyEverOpened(sessionId)
    }
  }

  /** Drop the pending request for `sessionId`, once its owning component has read it. */
  complete(sessionId: SessionId): void {
    if (!this.pending.delete(sessionId)) return
    this.notify(sessionId)
  }

  /**
   * An `ObservableSnapshot` scoped to one session's own pending request.
   * Memoized per `sessionId`: `@deepseek-ai/dsh-client-ui-renderer`'s
   * `bindSnapshotSelector` captures `subscribe`/`getSnapshot` once per
   * *source object* into a stable closure, on the documented assumption
   * that a caller's `inject()` hands it the same reference across renders.
   * `inject()` here calls this method fresh on every render (it has no
   * memoization of its own), so a fresh object literal per call would
   * silently break that contract — every render would look like a new
   * source to bind, forcing a resubscribe on every single render of
   * `ConversationRoot`/`ConversationSessionHeader`/`ConversationSession`
   * (all three read one of this registry's hooks). `ConversationRoot` in
   * particular re-renders on every streamed token during an active
   * response, so this was not a cosmetic inefficiency: the resulting
   * subscribe/unsubscribe churn was severe enough to make the whole
   * conversation column (Chat and Trajectory included, since they mount
   * inside this same forked skeleton) stop responding to scroll input.
   */
  hookFor(sessionId: SessionId): ObservableSnapshot<PendingFileOpen | undefined> {
    let hook = this.pendingHooks.get(sessionId)
    if (hook === undefined) {
      hook = {
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
      this.pendingHooks.set(sessionId, hook)
    }
    return hook
  }

  /**
   * An `ObservableSnapshot` of whether `sessionId` has ever had a file
   * opened — sticky, never reverts to `false`. Memoized per `sessionId` for
   * the same reason `hookFor` is — see that method's own doc comment.
   */
  hookForEverOpened(sessionId: SessionId): ObservableSnapshot<boolean> {
    let hook = this.everOpenedHooks.get(sessionId)
    if (hook === undefined) {
      hook = {
        getSnapshot: () => this.everOpened.has(sessionId),
        subscribe: (fn) => {
          let set = this.everOpenedListeners.get(sessionId)
          if (set === undefined) {
            set = new Set()
            this.everOpenedListeners.set(sessionId, set)
          }
          set.add(fn)
          return () => {
            set.delete(fn)
            if (set.size === 0) this.everOpenedListeners.delete(sessionId)
          }
        },
      }
      this.everOpenedHooks.set(sessionId, hook)
    }
    return hook
  }

  private notify(sessionId: SessionId): void {
    for (const fn of this.listeners.get(sessionId) ?? []) fn()
  }

  private notifyEverOpened(sessionId: SessionId): void {
    for (const fn of this.everOpenedListeners.get(sessionId) ?? []) fn()
  }
}
