/**
 * Fork of `dsh-client-ui-conversation`'s own
 * `skeleton/ConversationSession.tsx` `ConversationSession` export — same
 * body, plus one effect that drains a pending `conversationFileOpener`
 * request into the Session's own `openView` action. `ConversationSessionHeader`
 * (the file's other export) is unchanged and reused directly from
 * `@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationSession.tsx`
 * — see `./apply.ts`.
 */

import { useEffect } from 'react'
import type { ConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import { conversationPhase } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/snapshot.ts'
import { resolveActiveView } from '@deepseek-ai/dsh-client-ui-conversation/src/client/view-selection.ts'
// Local copy, not a cross-package import: the CSS-modules-inline transform
// resolves only relative paths (see ../client-ui-workspace-enhanced's own
// README for the same finding with WorkspaceBrowser.module.css).
import css from './ConversationRoot.module.css'
import type { InjectFace, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnhancedConversationSessionInjected } from './apply.ts'

/**
 * Full props: the pristine Session body contract (`ConversationSessionSlotProps`),
 * reconstructed with the widened `EnhancedConversationSessionInjected` face
 * in place of the pristine `ConversationSessionInjected` one.
 */
export type EnhancedConversationSessionProps =
  PropsRuntime<'conversation.session'>
  & PropsRenderSlots<'conversation.view'>
  & PropsStore<ConversationStore>
  & InjectFace<EnhancedConversationSessionInjected>

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible. Also drains
 * one pending `conversationFileOpener` request per render, addressed to
 * this Session's own id, by calling this Session's own `openView` action —
 * the only way to reach a live per-session store instance from outside its
 * render tree (`../ARCHITECTURE.md`'s "File tab: a pristine slot, but a
 * fork-only trigger").
 * @param props - Strict Session input/store, view ledger, pending file-open, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView, usePendingFileOpen, completePendingFileOpen,
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

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  // 'file' is dsh-plugins-client-ui-conversation-files's own registered
  // conversation.view id — the only consumer of this focus payload shape
  // (see that package's FileView.tsx `OpenFileFocus`/`parseOpenFileFocus`).
  useEffect(() => {
    if (pendingFileOpen === undefined) return
    openView('file', JSON.stringify({ path: pendingFileOpen.path, workspaceId: pendingFileOpen.workspaceId }))
    completePendingFileOpen()
  }, [pendingFileOpen, openView, completePendingFileOpen])

  if (session.blank && conversationPhase(session, conversation) === 'blank') return null
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
