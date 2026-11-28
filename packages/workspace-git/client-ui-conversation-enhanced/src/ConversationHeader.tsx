/**
 * Fork of dsh-client-ui-conversation's own skeleton/ConversationHeader.tsx
 * (the resident navigation header, computing the blank/Hero chrome-hiding
 * decision once and passing it to the strict Session header as an owner
 * prop). Forked for the same reason as ./ConversationMainPanel.tsx: the
 * blank computation also stays false once everOpenedFile is true, so a
 * file opened before a session's first turn shows the ordinary header
 * (breadcrumbs, view tabs) instead of staying hidden behind the Hero
 * screen. See ../apply.ts's registerHeader and ../ARCHITECTURE.md's "File
 * tab: a pristine slot, but a fork-only trigger".
 *
 * Ported forward from this pin bump: the `headerSessionless` class was
 * dropped from the header's className list by upstream (a real upstream
 * change, not a divergence reason) -- ported as dropped, along with the
 * doc comment explaining the now-empty sessionless title row.
 *
 * css below is a cross-package import of vendor's own
 * ConversationRoot.module.css, NOT a local copy -- see
 * ./ConversationMainPanel.tsx's own doc comment for why.
 */
import clsx from 'clsx'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots/client'
import { conversationPhase } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/snapshot.ts'
import css from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import type { ConversationHeaderInjected } from './apply.ts'

/**
 * Full props: the pristine header contract, reconstructed with this
 * package's own additive ConversationHeaderInjected face in place of the
 * pristine row's own (empty) contract.
 */
export type EnhancedConversationHeaderProps =
  PropsRuntime<'conversation.header'>
  & PropsRenderSlots<'conversation.header.leading' | 'conversation.session.header'>
  & InjectFace<ConversationHeaderInjected>

/**
 * Keeps global navigation available before a Session exists.
 * @param props - see {@link EnhancedConversationHeaderProps}.
 * @returns The persistent header with any selected Session's title and views.
 */
export function ConversationHeader({
  sessionId, useSession, useConversation, useEverOpenedFile, renderSlot,
}: EnhancedConversationHeaderProps) {
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const everOpenedFile = useEverOpenedFile(value => value)
  const blank = session === undefined || conversation === undefined
    || (session.blank && conversationPhase(session, conversation) === 'blank' && !everOpenedFile)
  return (
    <header className={clsx(css.header, blank && css.headerBlank)} data-window-drag>
      <div className={css.headerLeading} data-conversation-header-leading="">
        {renderSlot('conversation.header.leading', {})}
      </div>
      {sessionId === undefined
        // The empty title row keeps the blank-Session header height, so the
        // Hero centers its input card at the same offset before a Session exists.
        ? <div className={css.titleRow} />
        : renderSlot('conversation.session.header', { hideChrome: blank })}
    </header>
  )
}
