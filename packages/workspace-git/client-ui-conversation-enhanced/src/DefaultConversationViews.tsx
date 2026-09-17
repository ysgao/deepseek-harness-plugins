/**
 * Fork of `dsh-client-ui-conversation`'s own
 * `skeleton/DefaultConversationViews.tsx` (the pristine `ConversationSession`
 * body, extracted to its own file upstream). This fork gains two effects:
 * one drains a pending `conversationFileOpener` request into the Session's
 * own `openView` action, the other lands every mount of the Session on the
 * Chat View rather than on the persisted View preference the pristine store
 * rehydrates (the File View cannot restore what it was showing — see that
 * effect's own comment). It also gains the same widened blank/Hero gate
 * `./ConversationMainPanel.tsx` and `./ConversationSession.tsx`'s
 * `ConversationSessionHeader` carry: `dsh-client-ui-conversation`'s pristine
 * `session.blank && conversationPhase(...) === 'blank'` check also stays
 * open once `everOpenedFile` is true — the `FileOpenRegistry`'s sticky
 * per-session bit set the moment a file has ever been opened there, so a
 * File preview requested before any turn is not silently hidden behind the
 * Hero screen. See `../ARCHITECTURE.md`'s "File tab: a pristine slot, but a
 * fork-only trigger".
 */
import { useEffect } from 'react'
import { conversationPhase } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/snapshot.ts'
import { resolveActiveView } from '@deepseek-ai/dsh-client-ui-conversation/src/client/view-selection.ts'
// Cross-package import, not a local copy — see ./ConversationMainPanel.tsx's
// own doc comment.
import css from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import type { EnhancedConversationSessionProps } from './ConversationSession.tsx'

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible. Also drains
 * one pending `conversationFileOpener` request per render, addressed to
 * this Session's own id, by calling this Session's own `openView` action —
 * the only way to reach a live per-session store instance from outside its
 * render tree (`../../../../ARCHITECTURE.md`'s "File tab: a pristine slot, but a
 * fork-only trigger").
 * @param props - see {@link EnhancedConversationSessionProps}.
 * @returns the active view area, or null while the Session remains blank and has never shown a file.
 */
export function EnhancedDefaultConversationViews({
  useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView, usePendingFileOpen, completePendingFileOpen, useEverOpenedFile,
}: EnhancedConversationSessionProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)
  const pendingFileOpen = usePendingFileOpen(value => value)
  const everOpenedFile = useEverOpenedFile(value => value)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  // A Session's persisted store — its View selection included — is
  // rehydrated on every mount of its own session-scope subtree, and clicking
  // a conversation in the sidebar remounts exactly that (the renderer keys
  // strict session entries by session id). Only Chat and Trajectory actually
  // survive that round trip: the File view's opened path lives in that tab
  // component's own state, never in this store (the one-shot `viewRequest`
  // handoff merely passes through it, and the tab acknowledges it
  // immediately), so a rehydrated `view: 'file'` lands on the tab's "no file
  // opened yet" resting notice instead of the file that was showing there.
  // Every entry into a Session therefore lands on Chat — 'chat' being
  // dsh-client-ui-chat's own registered `conversation.view` id, and the same
  // id as `view-selection.ts`'s own (unexported) `DEFAULT_VIEW_ID`. A file
  // request already queued when this Session mounted is the one exception:
  // the drain below is about to open the File view for it, so that selection
  // is left alone rather than fought over.
  useEffect(() => {
    if (pendingFileOpen === undefined) actions.setView('chat')
    // Mount-only (empty deps): this is the landing decision for this mount of
    // the Session, not a rule to re-apply on later renders — the user's own
    // tab clicks (ConversationSessionHeader's `selectView`) have to stick.
  }, [])

  // 'file' is dsh-plugins-client-ui-conversation-files's own registered
  // conversation.view id — the only consumer of this focus payload shape
  // (see that package's FileView.tsx `OpenFileFocus`/`parseOpenFileFocus`).
  // Deps pinned to pendingFileOpen alone, the same convention the draft-mirror
  // effect above uses: `openView`/`completePendingFileOpen` are fresh closures
  // every render (apply.ts's `inject()` recreates them), but both close over
  // this same Session instance's unchanging sessionId, so including them
  // would rerun this drain on every unrelated render instead of only when a
  // new request actually arrives.
  useEffect(() => {
    if (pendingFileOpen === undefined) return
    openView('file', JSON.stringify({ path: pendingFileOpen.path, workspaceId: pendingFileOpen.workspaceId }))
    completePendingFileOpen()
  }, [pendingFileOpen])

  if (session.blank && conversationPhase(session, conversation) === 'blank' && !everOpenedFile) return null
  return (
    <div className={css.viewArea}>
      {active !== undefined && renderSlot('conversation.view', {
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: active.id })}
    </div>
  )
}
