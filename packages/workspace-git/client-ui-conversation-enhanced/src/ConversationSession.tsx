/**
 * Fork of `dsh-client-ui-conversation`'s own `skeleton/ConversationSession.tsx`
 * — now just `ConversationSessionHeader` (the title/tabs header) in the
 * pristine package too; `ConversationSession` (the Session body) is a thin
 * wrapper delegating to `./DefaultConversationViews.tsx` — see that file's
 * own doc comment for the actual behavior change (the pending-file-open
 * drain, the Chat-landing effect, and the `everOpenedFile` gate).
 * `ConversationSessionHeader` here gains the same widened blank/Hero gate:
 * `dsh-client-ui-conversation`'s pristine
 * `session.blank && conversationPhase(...) === 'blank'` check (which hides
 * header tabs, in favor of the centered Hero landing screen, until the
 * session's first turn) also stays open once `everOpenedFile` is true — the
 * `FileOpenRegistry`'s sticky per-session bit set the moment a file has
 * ever been opened there, so a File preview requested before any turn is
 * not silently hidden behind the Hero screen. `ConversationMainPanel`
 * carries the matching third fork of this same gate (its own `hero`
 * computation) — see `./ConversationMainPanel.tsx` and
 * `../ARCHITECTURE.md`'s "File tab: a pristine slot, but a fork-only trigger".
 */

import clsx from 'clsx'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import { conversationPhase } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/snapshot.ts'
import { resolveActiveView } from '@deepseek-ai/dsh-client-ui-conversation/src/client/view-selection.ts'
// Cross-package import, not a local copy — see ./ConversationMainPanel.tsx's
// own doc comment: this file's `.header`/`.viewArea`/etc. classnames must
// resolve to the same compiled CSS Modules scope as `ConversationMainPanel`'s
// `.root` and the reused-unchanged `ConversationContent.tsx`'s own
// classnames from this identical vendor file.
import css from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { EnhancedConversationSessionHeaderInjected, EnhancedConversationSessionInjected } from './apply.ts'
import { EnhancedDefaultConversationViews } from './DefaultConversationViews.tsx'

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
 * Full props: the pristine Session header contract
 * (`ConversationSessionHeaderSlotProps`), reconstructed with the widened
 * `EnhancedConversationSessionHeaderInjected` face in place of the pristine
 * `ConversationSessionHeaderInjected` one.
 */
export type EnhancedConversationSessionHeaderProps =
  PropsRuntime<'conversation.session.header'>
  & PropsRenderSlots<
    'conversation.session.header.lineage'
    | 'conversation.session.header.actions'
    | 'conversation.session.header.utilities'
    | 'conversation.session.header.corner'
  >
  & PropsStore<ConversationStore>
  & InjectFace<EnhancedConversationSessionHeaderInjected>
  & PropsLocale<'conversation'>

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - see {@link EnhancedConversationSessionHeaderProps}.
 * @returns the hidden blank-session header, or visible title and tabs once
 * engaged or once a file has ever been opened for this session.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useConversation, useConversationViews, useStore,
  renderSlot, open, selectView, useEverOpenedFile, t,
}: EnhancedConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const everOpenedFile = useEverOpenedFile(value => value)
  const hideChrome = session.blank && conversationPhase(session, conversation) === 'blank' && !everOpenedFile

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
            <div className={css.headerCorner} data-conversation-header-corner="">
              {renderSlot('conversation.session.header.corner', {})}
            </div>
          </div>
          {tabs.length > 1 && (
            <div className={css.tabs} role="tablist">
              {tabs.map(viewTab => (
                <button
                  key={viewTab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                  onClick={() => { selectView(viewTab.id) }}
                >
                  {viewTab.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport.
 * @param props - see {@link EnhancedConversationSessionProps}.
 * @returns the active view area, or null while the Session remains blank and has never shown a file.
 */
export function ConversationSession(props: EnhancedConversationSessionProps) {
  return <EnhancedDefaultConversationViews {...props} />
}
