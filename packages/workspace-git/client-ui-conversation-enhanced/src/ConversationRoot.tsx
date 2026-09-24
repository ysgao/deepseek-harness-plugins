/**
 * Fork of dsh-client-ui-conversation's own skeleton/ConversationRoot.tsx
 * -- a thin two-line wrapper in the pristine package too, delegating its
 * whole body to ConversationMainPanel. This fork's only change: it
 * delegates to this package's own ./ConversationMainPanel.tsx fork instead
 * of vendor's -- see that file's own doc comment for the actual behavior
 * change (the everOpenedFile Hero gate).
 */
// Resident conversation skeleton. Hero chrome, composer positioning, the
// chain, AND the composer bar (session-maybe slot) stay mounted across
// no-session/session transitions -- the bar renders inert via owner props.

import { ConversationMainPanel } from './ConversationMainPanel.tsx'
import type { EnhancedConversationMainPanelProps } from './ConversationMainPanel.tsx'

/** Full props composed from the slot contract (widened -- see ./ConversationMainPanel.tsx). */
export type EnhancedConversationRootProps = EnhancedConversationMainPanelProps

export function ConversationRoot(props: EnhancedConversationRootProps) {
  return <ConversationMainPanel {...props} />
}
