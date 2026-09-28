/**
 * "Next sentence" ghost text: a CodeMirror 6 extension that renders a
 * predicted sentence/line as dimmed, non-editable phantom text right after
 * the cursor — the well-known Copilot/Smart-Compose UX — and accepts it with
 * `Tab` or dismisses it with `Escape` or any further typing. This is a
 * different UI primitive from `autocompletion()`'s popup (`wordCompletion.ts`
 * plus, for a recognized `lang`, `languages.ts`'s own completion source): a
 * discrete word/identifier suits a dropdown of alternatives, but a whole
 * predicted sentence reads far better as inline phantom text the writer can
 * simply keep typing past than as one long item in a completion list. The
 * two coexist without conflict — `autocompletion()`'s own default keymap
 * binds `Ctrl`/`Cmd`-`Space`, `Enter`, and `Escape` (closing an *open*
 * popup), never `Tab`, so `Tab`-to-accept below is free; `Escape` falls
 * through to this extension's own dismiss only when no completion popup
 * consumed it first (registration order in `FileEditor.tsx`'s extension
 * list — this module's keymap is registered before that component's own
 * `keymap.of([indentWithTab, ...])`, so a pending suggestion's `Tab`-accept
 * is tried, and wins, before `indentWithTab`'s unconditional indent).
 *
 * Every recompute happens on a short debounce timer, never synchronously
 * inside a `ViewPlugin.update()` call — dispatching a transaction from
 * directly inside CodeMirror's own update cycle is the one thing its own
 * docs warn against (recursive `dispatch`); a `setTimeout` callback runs
 * safely outside that cycle, and doubles as exactly the debounce a
 * fast typist or an async model call both want anyway.
 *
 * At most one `predictAsync` call is ever outstanding per editor instance:
 * a new pause point aborts the previous attempt's signal before starting
 * the next one, and the view's own teardown (`destroy()`) aborts whatever
 * is still outstanding. This matters specifically because `predictAsync` is
 * expected to be backed by a real model call (see `FileEditor.tsx`'s
 * `predictSentence` prop) — a fast typist who keeps writing past several
 * pause points must not leave a growing tail of abandoned, still-billing
 * requests whose results nothing will ever show.
 * @module dsh-plugins-client-ui-file-editing/codemirror/ghostText
 */

import type { Extension } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { isPausePoint, predictNextSentence } from './sentencePrediction.ts'

/** Debounce between the triggering keystroke and a suggestion being computed/requested — long enough to coalesce a fast typist's run of keystrokes (e.g. several trailing spaces after a period) into one recompute, short enough that the local heuristic's suggestion still feels immediate. */
const DEBOUNCE_MS = 200

/**
 * Optional model-backed upgrade over the local, in-buffer heuristic
 * ({@link predictNextSentence}). Left `undefined`, the extension is the
 * local heuristic alone — no network call, no Host round-trip, on by
 * default for every prose kind (see `FileEditor.tsx`).
 */
export interface SentenceGhostTextOptions {
  /**
   * Called only at the same pause points the local heuristic itself fires
   * at (see {@link isPausePoint}) — never on every keystroke — with the
   * document text preceding the cursor and a signal aborted the moment a
   * later keystroke supersedes this attempt (see this module's own doc
   * comment on cancellation). Its resolved suggestion replaces whatever the
   * local heuristic already showed once it arrives, provided the cursor is
   * still exactly where the request was made from; a `null` result, an
   * empty string, a rejected promise, an aborted signal, or a since-moved
   * cursor all leave the local guess (if any) exactly as it was. A caller
   * that skips this option keeps the feature entirely client-side.
   */
  predictAsync?: (before: string, signal: AbortSignal) => Promise<string | null>
}

/** A displayed suggestion: the phantom text, and the exact cursor offset it was computed for (used to validate `Tab`-accept and an async reply both still apply). */
interface Suggestion {
  pos: number
  text: string
}

/** Sets (or, with `null`, clears) the current suggestion. */
const setSuggestion = StateEffect.define<Suggestion | null>()

/**
 * Holds the active suggestion, if any. Cleared by any transaction that
 * changes the document or moves the selection and does not itself carry a
 * `setSuggestion` effect — a suggestion computed for one cursor position is
 * never valid at another, so the safe default is "gone until recomputed",
 * exactly like `autocompletion()`'s own popup closes on an unrelated edit.
 */
const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestion)) return effect.value
    }
    if (tr.docChanged || tr.selection !== undefined) return null
    return value
  },
})

/** Renders a `Suggestion`'s text as an inert, unselectable inline span. */
class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  override eq(other: GhostTextWidget): boolean { return other.text === this.text }
  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-sentence-ghost-text'
    span.textContent = this.text
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  override ignoreEvent(): boolean { return true }
}

const suggestionDecoration = EditorView.decorations.compute([suggestionField], (state) => {
  const suggestion = state.field(suggestionField)
  if (suggestion === null) return Decoration.none
  return Decoration.set([Decoration.widget({ widget: new GhostTextWidget(suggestion.text), side: 1 }).range(suggestion.pos)])
})

/** Dimmed, italic, non-interactive phantom-text styling — deliberately a `baseTheme` (lowest precedence) so a host theme can override it, matching how `editorTheme.ts` itself only ever raises, never fights, the app's own `--dsw-*` tokens. */
const ghostTextTheme = EditorView.baseTheme({
  '.cm-sentence-ghost-text': {
    opacity: '0.55',
    fontStyle: 'italic',
    pointerEvents: 'none',
  },
})

/**
 * Debounces suggestion recomputation behind every relevant view update, and
 * owns the one outstanding `predictAsync` call's cancellation — see this
 * module's own doc comment on why only one is ever allowed to be in flight.
 */
const ghostTextPlugin = (options: SentenceGhostTextOptions) => ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: AbortController | undefined

  update(update: ViewUpdate): void {
    if (!update.docChanged && !update.selectionSet) return
    window.clearTimeout(this.timer)
    const view = update.view
    this.timer = setTimeout(() => { this.recompute(view) }, DEBOUNCE_MS)
  }

  /**
   * Recompute (or clear) the suggestion for the view's current cursor —
   * called only from the debounce timer above, never synchronously from
   * `update()`.
   * @param view - the editor view to recompute for.
   */
  private recompute(view: EditorView): void {
    const selection = view.state.selection.main
    if (!selection.empty) return
    const pos = selection.head
    const doc = view.state.doc.toString()
    if (!isPausePoint(doc, pos)) {
      if (view.state.field(suggestionField) !== null) view.dispatch({ effects: setSuggestion.of(null) })
      return
    }
    const local = predictNextSentence(doc, pos)
    if (local !== null) view.dispatch({ effects: setSuggestion.of({ pos, text: local }) })
    if (options.predictAsync === undefined) return
    // A new attempt always supersedes whatever the previous one was still
    // waiting on — see this module's own doc comment.
    this.inFlight?.abort()
    const controller = new AbortController()
    this.inFlight = controller
    const before = doc.slice(0, pos)
    options.predictAsync(before, controller.signal).then((remote) => {
      if (controller.signal.aborted) return
      if (remote === null || remote.trim().length === 0) return
      const current = view.state.selection.main
      if (!current.empty || current.head !== pos) return // the writer has moved on; the stale reply is discarded.
      view.dispatch({ effects: setSuggestion.of({ pos, text: remote }) })
    }).catch(() => {
      // A failing or aborted provider (network error, no model configured,
      // superseded attempt, etc.) simply leaves whatever the local
      // heuristic already showed — see this function's own doc comment.
    })
  }

  destroy(): void {
    window.clearTimeout(this.timer)
    this.inFlight?.abort()
  }
})

/** `Tab` accepts the active suggestion (inserting its text and moving the cursor past it); `Escape` dismisses it. Both fall through (`return false`) with no suggestion active, so `Tab` reaches `indentWithTab` and `Escape` reaches whatever else wants it — see this module's own doc comment on registration order. */
const acceptOrDismissKeymap = keymap.of([
  {
    key: 'Tab',
    run(view) {
      const suggestion = view.state.field(suggestionField)
      const selection = view.state.selection.main
      if (suggestion === null || !selection.empty || selection.head !== suggestion.pos) return false
      view.dispatch({
        changes: { from: suggestion.pos, insert: suggestion.text },
        selection: { anchor: suggestion.pos + suggestion.text.length },
        effects: setSuggestion.of(null),
      })
      return true
    },
  },
  {
    key: 'Escape',
    run(view) {
      if (view.state.field(suggestionField) === null) return false
      view.dispatch({ effects: setSuggestion.of(null) })
      return true
    },
  },
])

/**
 * Build the "next sentence" ghost-text extension — see this module's own
 * doc comment. Local-heuristic-only when called with no options.
 * @param options - see {@link SentenceGhostTextOptions}.
 * @returns the CodeMirror extensions to add to the editor's own list.
 */
export function sentenceGhostText(options: SentenceGhostTextOptions = {}): Extension {
  return [suggestionField, suggestionDecoration, ghostTextTheme, ghostTextPlugin(options), acceptOrDismissKeymap]
}
