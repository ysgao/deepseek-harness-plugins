/**
 * Fork of dsh-client-ui-conversation's own skeleton/ConversationSession.tsx
 * -- upstream now splits this into ConversationSessionHeader (the
 * title/tabs header, reused unchanged from vendor by ../apply.ts's
 * registerSessionHeader: it now receives its blank/Hero decision as a
 * hideChrome owner prop computed by the parent header, see
 * ./ConversationHeader.tsx, instead of computing it itself) and
 * ConversationSession (the Session body, forked here only to delegate to
 * this package's own ./DefaultConversationViews.tsx fork instead of
 * vendor's -- see that file's own doc comment for the actual behavior
 * change: the pending-file-open drain, the Chat-landing effect, and the
 * everOpenedFile gate).
 */
import type { InjectFace, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import type { EnhancedConversationSessionInjected } from './apply.ts'
import { EnhancedDefaultConversationViews } from './DefaultConversationViews.tsx'

/**
 * Full props: the pristine Session body contract (ConversationSessionSlotProps),
 * reconstructed with the widened EnhancedConversationSessionInjected face
 * in place of the pristine ConversationSessionInjected one.
 */
export type EnhancedConversationSessionProps =
  PropsRuntime<'conversation.session'>
  & PropsRenderSlots<'conversation.view'>
  & PropsStore<ConversationStore>
  & InjectFace<EnhancedConversationSessionInjected>

/**
 * Renders the active Session view inside the resident scrollport.
 * @param props - see {@link EnhancedConversationSessionProps}.
 * @returns the active view area, or null while the Session remains blank and has never shown a file.
 */
export function ConversationSession(props: EnhancedConversationSessionProps) {
  return <EnhancedDefaultConversationViews {...props} />
}
