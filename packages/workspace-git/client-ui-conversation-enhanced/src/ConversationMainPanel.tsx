/**
 * Fork of dsh-client-ui-conversation's own
 * skeleton/ConversationMainPanel.tsx -- same body (renders the header slot
 * then the conversation.content Factory), with one change: hero (and
 * therefore phase) also stays false once everOpenedFile is true -- the
 * FileOpenRegistry's sticky per-session bit set the moment a file has ever
 * been opened there. Without this, a session that has never had its first
 * turn would still render the centered Hero landing screen instead of the
 * active-phase layout (ordinary header chrome, sticky bottom composer)
 * ConversationHeader's own matching fork now shows once a file has been
 * opened -- see ./ConversationHeader.tsx and ../ARCHITECTURE.md's "File
 * tab: a pristine slot, but a fork-only trigger".
 *
 * ./ConversationRoot.tsx is forked only to point at this file instead of
 * vendor's own ConversationMainPanel.tsx; conversation.content's own
 * Factory component (ConversationContent.tsx, registered unchanged by
 * ../apply.ts's registerConversationContent) is reused unchanged from that
 * package's own ./src/* export, since none of it reads hero/phase any
 * differently than before -- this fork only changes the two values
 * themselves before they reach it.
 *
 * css below is a cross-package import of vendor's own
 * ConversationRoot.module.css, NOT a local copy -- see this package's
 * README for why: ConversationContent.tsx (reused unchanged) and
 * ./ConversationHeader.tsx's fork both need this exact div's .root class to
 * match the SAME compiled CSS Modules scope their own selectors are
 * compiled against.
 */
import type { InjectFace, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { conversationPhase } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/snapshot.ts'
import { ConversationWidthControls } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationWidthControls.tsx'
import css from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import type { ConversationRootInjected } from './apply.ts'

/**
 * Full props: the pristine root contract (was ConversationSlotProps),
 * reconstructed with this package's own additive ConversationRootInjected
 * face in place of the pristine row's own (now empty) contract.
 */
export type EnhancedConversationMainPanelProps =
  PropsRuntime<'main.conversation'>
  & PropsRenderSlots<'conversation.header'>
  & PropsRenderFactories
  & InjectFace<ConversationRootInjected>

/**
 * Render the existing main Conversation frame around the extracted content.
 * @param props - see {@link EnhancedConversationMainPanelProps}.
 * @returns the unchanged root, Header, content, and width-control subtree.
 */
export function ConversationMainPanel(props: EnhancedConversationMainPanelProps) {
  const {
    sessionId, useSession, useSessions, useConversation, useEverOpenedFile, renderSlot, renderFactorySlot,
  } = props
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const shellPhase = session === undefined || conversation === undefined
    ? 'blank'
    : conversationPhase(session, conversation)
  const openState = session?.openState
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  const everOpenedFile = useEverOpenedFile(value => value)

  // While a session is still replaying (loading + blank) the hero/docked
  // choice is unknowable -- render the composer hidden instead of flashing
  // the centered hero and snapping to the docked bar (or vice versa).
  // Exemption: a session the list summary already proves blank can only
  // land on the hero, so hiding would blank the column for the whole
  // history round-trip (the startup auto-selection flash) for nothing.
  // The exemption is deliberately open-state-wide, not loading-only: a
  // summary-blank session is the hero before its open starts (cold) and
  // after one fails (error) for the same reason -- there is no history.
  // A restored continuable subagent waits for a Host summary to establish
  // parent availability. This keeps the composer hidden instead of briefly
  // rendering the parent-offline takeover.
  const parentAvailabilityPending = session?.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = sessionId !== undefined && (
    (shellPhase === 'blank' && openState === 'loading' && summaryBlank !== true)
    || parentAvailabilityPending
  )
  // everOpenedFile (sticky once a file has ever been opened for this
  // session -- see FileOpenRegistry) keeps this false even while the
  // session has genuinely never had a first turn: a File preview opened
  // from the sidebar before any turn should land in the same active-phase
  // layout (ordinary header, docked composer) an engaged session gets, not
  // behind the centered Hero screen.
  const hero = sessionId === undefined
    || (shellPhase === 'blank' && (openState === 'open' || summaryBlank === true) && !everOpenedFile)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'

  return (
    <div className={css.root} data-phase={phase}>
      {renderSlot('conversation.header', {})}
      {renderFactorySlot('conversation.content', {
        variant: 'main',
        phase,
        hero,
      }, {
        slots: { widthControls: ConversationWidthControls },
      })}
    </div>
  )
}
