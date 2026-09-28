/**
 * Buffer-word completion: suggests whichever `\w+` tokens already appear
 * elsewhere in the same document, ranked by their offset from the cursor
 * (nearest first, matching CodeMirror 6's own default `boost` behavior for
 * "most likely" ordering). This is the one completion source `FileEditor`
 * wires unconditionally, `lang`/`kind` regardless — {@link languageExtensionFor}
 * has nothing to offer a plain-monospace file (an unrecognized extension, or
 * a `.txt`/`.log`), since there is no grammar to attach a completion source
 * to, but a word already typed once in that same file is still worth
 * re-offering on the second attempt. Registered via `EditorState.languageData`
 * (state-level, not tied to being inside any particular `Language` node) so
 * it runs for every buffer; `autocompletion()` itself (no `override`) merges
 * it with whatever {@link languageExtensionFor} additionally contributes for
 * a recognized language, rather than either replacing the other.
 * @module dsh-plugins-client-ui-file-editing/codemirror/wordCompletion
 */

import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

/** Cap on distinct suggestions returned per keystroke — plenty for a completion popup, and bounds the cost of a very large file. */
const MAX_SUGGESTIONS = 100

/**
 * The query pattern `matchBefore` anchors a suggestion to — `*`, not `+`, is
 * deliberate and matches the canonical `CompletionSource` shape CodeMirror 6's
 * own docs recommend: it still matches (a zero-length range) when the cursor
 * isn't adjacent to a word character, so an explicit request (`Ctrl`/`Cmd`
 * -`Space`) works from any position, not only mid-word.
 */
const WORD_QUERY = /\w*/
/** `\w+` — every nonempty word token in the document, scanned separately from {@link WORD_QUERY} since a zero-length match has nothing to look up. Deliberately ASCII-word-only (no `\p{...}` property-escape matching), matching every recognized `lang`'s own identifier grammar closely enough for a plain re-typed-word suggestion. */
const WORD_SCAN = /\w+/g

/**
 * A `CompletionSource` offering every other `\w+` occurrence in the
 * document as a completion for the token the cursor is currently inside.
 * @param context - cursor position and document snapshot.
 * @returns completions anchored to the current word, or `null` when the
 * cursor isn't inside a word and completion wasn't explicitly requested
 * (`Ctrl`/`Cmd`-`Space`) — the same "don't pop up uninvited" contract every
 * other `CompletionSource` in this codebase follows.
 */
export function wordCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(WORD_QUERY)
  if (word === null || (word.from === word.to && !context.explicit)) return null
  const cursor = word.to
  const doc = context.state.doc.toString()
  const distanceByWord = new Map<string, number>()
  WORD_SCAN.lastIndex = 0
  for (let match = WORD_SCAN.exec(doc); match !== null; match = WORD_SCAN.exec(doc)) {
    const token = match[0]
    if (token === word.text) continue // the token being completed, not a suggestion for itself.
    const distance = Math.abs(match.index - cursor)
    const known = distanceByWord.get(token)
    if (known === undefined || distance < known) distanceByWord.set(token, distance)
  }
  if (distanceByWord.size === 0) return null
  const ranked = [...distanceByWord.entries()].sort((a, b) => a[1] - b[1]).slice(0, MAX_SUGGESTIONS)
  return {
    from: word.from,
    options: ranked.map(([label]) => ({ label, type: 'text' })),
  }
}
