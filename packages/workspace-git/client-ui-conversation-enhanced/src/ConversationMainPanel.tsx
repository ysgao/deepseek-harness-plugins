/**
 * Fork of `dsh-client-ui-conversation`'s own
 * `skeleton/ConversationMainPanel.tsx` — same body (Hero chrome, composer
 * positioning, resize-observer width publishing), with one change: `hero`
 * (and therefore `phase`) also stays false once `everOpenedFile` is true —
 * the `FileOpenRegistry`'s sticky per-session bit set the moment a file has
 * ever been opened there. Without this, a session that has never had its
 * first turn would still render the centered Hero landing screen instead of
 * the active-phase layout (ordinary header chrome, sticky bottom composer,
 * width handles) `ConversationSessionHeader`/`ConversationSession`'s own
 * matching fork now shows once a file has been opened — see
 * `./ConversationSession.tsx` and `../ARCHITECTURE.md`'s "File tab: a
 * pristine slot, but a fork-only trigger".
 *
 * `./ConversationRoot.tsx` — now a thin two-line wrapper in the pristine
 * package too — is forked only to point at this file instead of vendor's
 * own `ConversationMainPanel.tsx`; `ConversationContent.tsx` (the composer
 * chain, width-handle drag plumbing, and the rest of the visible tree) is
 * reused unchanged from that package's own `./src/*` export, since none of
 * it reads `hero`/`phase` any differently than before — this fork only
 * changes the two values themselves before they reach it.
 *
 * `css` below is a cross-package import of vendor's own
 * `ConversationRoot.module.css`, NOT a local copy: `ConversationContent.tsx`
 * (reused unchanged) and `./ConversationSession.tsx`'s `ConversationSession
 * Header` fork both need this exact div's `.root` class and `data-phase`
 * attribute to match the SAME compiled CSS Modules scope their own
 * `.viewArea`/`.header`/etc. selectors are compiled against — the bundler
 * resolves this bare specifier and vendor's own relative sibling imports of
 * the identical file to the same absolute path, so both land as one shared,
 * de-duplicated CSS module with one consistent hash, not two independently
 * hashed ones that would silently fail every compound selector spanning
 * this root and its (unchanged) children. A local copy — correct for a
 * wholesale, self-contained fork like `WorkspaceBrowser.module.css` — would
 * break exactly this cross-file scope here.
 */
import { useCallback, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { conversationPhase } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/snapshot.ts'
import { ConversationContent } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationContent.tsx'
import css from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import type { EnhancedConversationInjected } from './apply.ts'

/**
 * Full props: the pristine root contract (was `ConversationSlotProps`),
 * reconstructed with the widened `EnhancedConversationInjected` face in
 * place of the pristine `ConversationInjected` one, and targeting
 * `main.conversation` (the slot this shell now registers into).
 */
export type EnhancedConversationMainPanelProps =
  PropsRuntime<'main.conversation'>
  & PropsRenderSlots<
    | 'conversation.session' | 'conversation.session.header'
    | 'conversation.composer' | 'conversation.composer.bar'
    | 'conversation.input.dock'
    | 'conversation.hero.brand.mark'
    | 'conversation.hero.workspace'
    | 'conversation.hero.agentPreset'
  >
  & InjectFace<EnhancedConversationInjected>
  & PropsLocale<'conversation'>

/** localStorage key for the dragged transcript width preference (px). */
const WIDTH_PREF_KEY = 'dsh.conversation.contentWidth'
/** Floor for a dragged content width; matches the layout center-column minimum. */
const CONTENT_MIN = 640
/** Column budget the content must leave free: 88px per side keeps the width
 * handles fully placeable (24px inset + 40px strip + 24px safe zone) — a
 * larger dragged width would push its own handles off the column and leave no
 * way to drag back. */
const CONTENT_EDGE_BUDGET = 176

/** Reads the persisted width preference; durable-storage boundary, so a
 * missing or corrupt value resolves to "no preference".
 * @returns the stored width in px, or null when unset or invalid. */
function readWidthPreference(): number | null {
  const raw = localStorage.getItem(WIDTH_PREF_KEY)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Resolves the content width the CSS axis would show for a column width.
 * @param columnWidth - the conversation column's rendered width in px.
 * @param preference - the dragged preference, or null for the adaptive clamp.
 * @returns the resolved content width in px (mirrors the CSS clamp). */
function resolveContentWidth(columnWidth: number, preference: number | null): number {
  const max = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET)
  if (preference !== null) return Math.min(Math.max(preference, CONTENT_MIN), max)
  return Math.max(680, Math.min(columnWidth * 0.64, 920))
}

/**
 * Render the existing main Conversation frame around the extracted content.
 * @param props - see {@link EnhancedConversationMainPanelProps}.
 * @returns the unchanged root, Header, content, and width-control subtree.
 */
export function ConversationMainPanel(props: EnhancedConversationMainPanelProps) {
  const { sessionId, useSession, useSessions, useConversation, useEverOpenedFile, renderSlot } = props
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const shellPhase = session === undefined || conversation === undefined
    ? 'blank'
    : conversationPhase(session, conversation)
  const openState = session?.openState
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  const everOpenedFile = useEverOpenedFile(value => value)

  // Publishes the column's live width as --dsh-conversation-column-width so
  // the shared width axis can adapt (see the .root CSS), and re-clamps a
  // dragged preference against the shrunken column WITHOUT rewriting the
  // stored preference — widening the window restores it (the AppFrame
  // sidebar-drag rule). Same callback-ref pattern as the seat observer.
  const rootEl = useRef<HTMLDivElement | null>(null)
  const rootObserver = useRef<ResizeObserver | null>(null)
  const publishWidths = useCallback((root: HTMLDivElement): void => {
    const column = root.offsetWidth
    root.style.setProperty('--dsh-conversation-column-width', `${column}px`)
    const preference = readWidthPreference()
    if (preference === null) {
      root.style.removeProperty('--dsh-chat-user-width')
    } else {
      root.style.setProperty('--dsh-chat-user-width', `${resolveContentWidth(column, preference)}px`)
    }
  }, [])
  const rootResizeRef = useCallback((root: HTMLDivElement | null): void => {
    rootObserver.current?.disconnect()
    rootObserver.current = null
    rootEl.current = root
    if (root === null) return
    rootObserver.current = new ResizeObserver(() => { publishWidths(root) })
    rootObserver.current.observe(root)
    publishWidths(root)
  }, [publishWidths])

  // Drag plumbing for the two width handles: onStart snapshots the resolved
  // width (grabbing a clamped column must not jump back to the raw stored
  // preference), onDrag publishes only the live clamped style, onCommit
  // persists the width of a gesture that actually travelled, and onEnd
  // republishes from storage — an uncommitted press leaves the stored
  // preference untouched.
  const onHandleStart = useCallback((): number => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return 680
    return resolveContentWidth(root.offsetWidth, readWidthPreference())
  }, [])
  const onHandleDrag = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    const clamped = resolveContentWidth(root.offsetWidth, width)
    root.style.setProperty('--dsh-chat-user-width', `${clamped}px`)
  }, [])
  const onHandleCommit = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    localStorage.setItem(WIDTH_PREF_KEY, `${resolveContentWidth(root.offsetWidth, width)}`)
  }, [])
  const onHandleEnd = useCallback((): void => {
    const root = rootEl.current
    if (root !== null) publishWidths(root)
  }, [publishWidths])

  // While a session is still replaying (loading + blank) the hero/docked
  // choice is unknowable — render the composer hidden instead of flashing
  // the centered hero and snapping to the docked bar (or vice versa).
  // Exemption: a session the list summary already proves blank can only
  // land on the hero, so hiding would blank the column for the whole
  // history round-trip (the startup auto-selection flash) for nothing.
  // The exemption is deliberately open-state-wide, not loading-only: a
  // summary-blank session is the hero before its open starts (`cold`) and
  // after one fails (`error`) for the same reason — there is no history.
  // A restored continuable subagent also stays settled until its eagerly
  // loaded parent catalog establishes availability. This keeps the composer
  // hidden instead of briefly rendering the parent-offline takeover.
  const parentAvailabilityPending = session?.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = sessionId !== undefined && (
    (shellPhase === 'blank' && openState === 'loading' && summaryBlank !== true)
    || parentAvailabilityPending
  )
  // `everOpenedFile` (sticky once a file has ever been opened for this
  // session — see FileOpenRegistry) keeps this false even while the session
  // has genuinely never had a first turn: a File preview opened from the
  // sidebar before any turn should land in the same active-phase layout
  // (ordinary header, docked composer) an engaged session gets, not behind
  // the centered Hero screen.
  const hero = sessionId === undefined
    || (shellPhase === 'blank' && (openState === 'open' || summaryBlank === true) && !everOpenedFile)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'

  return (
    <div ref={rootResizeRef} className={css.root} data-phase={phase}>
      {sessionId === undefined ? null : renderSlot('conversation.session.header', {})}
      <ConversationContent
        {...props}
        session={session}
        phase={phase}
        hero={hero}
        onHandleStart={onHandleStart}
        onHandleDrag={onHandleDrag}
        onHandleCommit={onHandleCommit}
        onHandleEnd={onHandleEnd}
      />
    </div>
  )
}
