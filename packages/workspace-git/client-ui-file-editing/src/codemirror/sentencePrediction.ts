/**
 * Local, in-browser "next sentence" prediction: at a natural writing pause
 * (a sentence just ended, or the cursor sits at the end of a non-empty
 * line), look for another place in the *same buffer* where an
 * identically-worded sentence or line was followed by something, and offer
 * that something back — the same "reuse text already in this file" posture
 * {@link ../codemirror/wordCompletion.ts!wordCompletionSource} already takes
 * for single words, extended to sentence/line granularity. It needs no
 * network call, no model, and no Host round-trip, so it is the always-on
 * default {@link ../FileEditor.tsx!FileEditor} wires for every prose kind
 * (see that module's own doc comment for exactly which kinds).
 *
 * This is deliberately a *pattern-reuse* heuristic, not generation: a
 * document that never repeats a sentence structure gets no suggestion at
 * all (`null`), same as {@link wordCompletionSource} on a word used only
 * once. It shines on the genuinely repetitive prose a lot of real files
 * are — numbered steps, changelog entries, FAQ-style Q/A pairs, checklists —
 * and is honestly useless on genuinely novel prose, which is exactly the
 * gap a model-backed suggestion (wired in separately, see
 * `SentenceGhostTextOptions.predictAsync` in `./ghostText.ts`) is for.
 *
 * Sentence/line splitting here is intentionally naive (ASCII punctuation,
 * no abbreviation/decimal-number handling, no locale-aware segmentation) —
 * the same tradeoff `wordCompletionSource`'s ASCII-only `\w+` scan already
 * makes. A stray "e.g." or "3.14" merely produces a shorter-than-intended
 * "sentence" occasionally; it never produces a wrong suggestion, only a
 * differently-scoped one.
 * @module dsh-plugins-client-ui-file-editing/codemirror/sentencePrediction
 */

/** A sentence- or line-shaped unit of the document, with its offsets. */
interface Unit {
  /** The unit's own text, terminator included (for a sentence) or not (for a line). */
  text: string
  /** Offset of the unit's first character. */
  start: number
  /** Offset just past the unit's last character (before any trailing separator). */
  end: number
}

/** Below this normalized length, a unit is too generic (a bare "-", a blank heading, "OK.") to trust as a match key — matching it would surface noise, not a real repeated pattern. */
const MIN_UNIT_LENGTH = 8

/** A sentence terminator, optionally followed by a closing quote/bracket — the same "end of sentence" shape used to both split sentences and detect a sentence-end pause. */
const TERMINATOR = /[.!?]/
const CLOSERS = '"\')]'

/**
 * Collapse-and-lowercase a unit's text for matching — two sentences that
 * differ only in whitespace or letter case still count as "the same
 * sentence" for lookup purposes (the suggestion offered back is always the
 * *other* occurrence's original casing, never this normalized form).
 * @param text - raw unit text.
 * @returns normalized text.
 */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Split `doc` into sentence-shaped units: a run of text ending in a
 * terminator (plus any closing quote/bracket) followed by whitespace or the
 * end of the document. Text with no terminator at all becomes one trailing
 * unit, so every character of `doc` belongs to exactly one unit's `[start,
 * end)` or the whitespace between two units.
 * @param doc - the full document text.
 * @returns sentence units in document order.
 */
function splitSentences(doc: string): Unit[] {
  const units: Unit[] = []
  let start = 0
  let i = 0
  while (i < doc.length) {
    if (TERMINATOR.test(doc[i]!)) {
      let end = i + 1
      while (end < doc.length && CLOSERS.includes(doc[end]!)) end++
      const atBoundary = end === doc.length || /\s/.test(doc[end]!)
      if (atBoundary) {
        const text = doc.slice(start, end)
        if (text.trim().length > 0) units.push({ text, start, end })
        let next = end
        while (next < doc.length && /\s/.test(doc[next]!)) next++
        start = next
        i = next
        continue
      }
    }
    i++
  }
  if (start < doc.length) {
    const text = doc.slice(start)
    if (text.trim().length > 0) units.push({ text, start, end: doc.length })
  }
  return units
}

/**
 * Split `doc` into line units (no trailing `\n`) — the fallback granularity
 * for prose that separates thoughts by line break rather than sentence
 * punctuation (list items, changelog entries, one-sentence-per-line style).
 * @param doc - the full document text.
 * @returns line units in document order.
 */
function splitLines(doc: string): Unit[] {
  const units: Unit[] = []
  let start = 0
  for (let i = 0; i <= doc.length; i++) {
    if (i === doc.length || doc[i] === '\n') {
      const text = doc.slice(start, i)
      if (text.trim().length > 0) units.push({ text, start, end: i })
      start = i + 1
    }
  }
  return units
}

/**
 * The unit ending at or immediately before `pos` — the sentence/line that
 * was just finished when the cursor paused at `pos`.
 * @param units - sentence or line units, in document order.
 * @param pos - cursor offset.
 * @returns the most recent unit ending at or before `pos`, or `null`.
 */
function currentUnit(units: readonly Unit[], pos: number): { index: number; unit: Unit } | null {
  for (let index = units.length - 1; index >= 0; index--) {
    const unit = units[index]!
    if (unit.end <= pos) return { index, unit }
  }
  return null
}

/**
 * Find the nearest other occurrence (by document distance from `pos`) of a
 * unit whose normalized text matches `current`'s, and return whatever unit
 * immediately follows *that* occurrence — the suggestion for what comes
 * after `current` here too.
 * @param units - sentence or line units, in document order.
 * @param currentIndex - index of the just-finished unit within `units`.
 * @param pos - cursor offset, for nearest-occurrence ranking (mirrors
 * `wordCompletionSource`'s own nearest-first ordering).
 * @returns the matched next unit's own text, or `null` when no other
 * occurrence exists (or none has a successor).
 */
function nextAfterNearestMatch(units: readonly Unit[], currentIndex: number, pos: number): string | null {
  const current = units[currentIndex]!
  const key = normalize(current.text)
  if (key.length < MIN_UNIT_LENGTH) return null
  let best: { distance: number; next: string } | null = null
  for (let i = 0; i < units.length; i++) {
    if (i === currentIndex) continue
    if (normalize(units[i]!.text) !== key) continue
    const successor = units[i + 1]
    if (successor === undefined) continue
    if (normalize(successor.text) === key) continue // a run of identical units repeating itself is not a useful "next sentence".
    const distance = Math.abs(units[i]!.start - pos)
    if (best === null || distance < best.distance) best = { distance, next: successor.text }
  }
  return best?.next ?? null
}

/**
 * Whether the text immediately before `pos` ends a sentence — a terminator
 * (plus optional closing quote/bracket) followed by whitespace already
 * typed. This is the "just finished a sentence" pause point.
 * @param doc - the full document text.
 * @param pos - cursor offset.
 * @returns whether `pos` sits right after a completed sentence.
 */
function isSentencePause(doc: string, pos: number): boolean {
  return /[.!?]["')\]]*\s$/.test(doc.slice(0, pos))
}

/**
 * Whether `pos` sits right after a newline that just closed a non-empty
 * line — the fallback "just finished a line" pause point, for prose that
 * does not end its thoughts in sentence punctuation (list items, headings,
 * changelog entries). Deliberately keyed on an *already-typed* newline
 * rather than "cursor at the end of the buffer": the latter is
 * indistinguishable from "still mid-word, simply hasn't reached a
 * terminator yet" (every character typed at the end of a growing last line
 * satisfies it), which would fire a suggestion attempt — and, worse, a
 * model-backed request (`./ghostText.ts`'s `SentenceGhostTextOptions.
 * predictAsync`) — on essentially every idle moment while composing,
 * defeating the whole point of gating on a real pause rather than
 * "continuously while idle". Requiring a newline already in the document
 * means this fires once, exactly when the writer presses Enter after a real
 * line — not before.
 * @param doc - the full document text.
 * @param pos - cursor offset.
 * @returns whether `pos` sits right after a newline that closed a non-empty line.
 */
function isLinePause(doc: string, pos: number): boolean {
  if (pos === 0 || doc[pos - 1] !== '\n') return false
  let lineStart = pos - 1
  while (lineStart > 0 && doc[lineStart - 1] !== '\n') lineStart--
  return doc.slice(lineStart, pos - 1).trim().length > 0
}

/**
 * Whether `pos` is a natural writing pause worth attempting a suggestion at
 * — see {@link isSentencePause} and {@link isLinePause}. Exported
 * separately from {@link predictNextSentence} so a caller (the ghost-text
 * CodeMirror extension) can gate a model-backed suggestion request on the
 * same pause points, rather than firing one on every keystroke.
 * @param doc - the full document text.
 * @param pos - cursor offset.
 * @returns whether this position is a sentence- or line-end pause.
 */
export function isPausePoint(doc: string, pos: number): boolean {
  return isSentencePause(doc, pos) || isLinePause(doc, pos)
}

/**
 * Predict the sentence (or line) that follows the one the cursor just
 * finished, by finding another occurrence of that same sentence/line
 * elsewhere in `doc` and returning what came after it there. Returns `null`
 * outside a pause point, or when no matching prior occurrence exists.
 * @param doc - the full document text.
 * @param pos - cursor offset (a plain, non-selecting cursor).
 * @returns the predicted next sentence/line's text, or `null`.
 */
export function predictNextSentence(doc: string, pos: number): string | null {
  if (isSentencePause(doc, pos)) {
    const sentences = splitSentences(doc)
    const found = currentUnit(sentences, pos)
    if (found !== null) {
      const bySentence = nextAfterNearestMatch(sentences, found.index, pos)
      if (bySentence !== null) return bySentence
    }
  }
  if (isLinePause(doc, pos)) {
    const lines = splitLines(doc)
    // `pos` itself sits one character past the newline that just closed the
    // relevant line (see `isLinePause`'s own doc comment), so the line
    // "current" here ends at `pos - 1`, not `pos`.
    const found = currentUnit(lines, pos - 1)
    if (found !== null) return nextAfterNearestMatch(lines, found.index, pos)
  }
  return null
}
