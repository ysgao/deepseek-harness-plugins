/**
 * Text-only extraction from RTF (Rich Text Format) markup, for
 * `../RtfPreview.tsx`. Deliberately the same posture `PptxPreview` already
 * takes for a `.pptx` deck: the document's *text*, in reading order, split
 * into paragraphs — no fonts, colors, sizes, alignment, images, or page
 * layout. RTF is plain text markup (its whole body is ASCII control words), so
 * unlike `.docx` there is nothing to unzip and no binary parser to depend on;
 * the trade-off is that recovering formatting would mean implementing a real
 * RTF reader, which a preview does not need. The raw markup stays one click
 * away in Edit mode.
 *
 * What the scanner does handle, because ignoring any of it produces visibly
 * wrong text rather than merely unformatted text:
 *
 * - Group nesting (`{…}`), each group inheriting its parent's state.
 * - Destination groups that hold no document text at all — font and color
 *   tables, the stylesheet, metadata, embedded picture/object data — which are
 *   skipped wholesale ({@link SKIPPED_DESTINATIONS}), as is any group flagged
 *   with `\*` (the "ignore if unrecognized" marker).
 * - `\uN` Unicode characters, including the `\ucN` fallback-length rule: after
 *   a `\uN`, the next N characters are a downlevel substitution for the same
 *   character and must be dropped, or every non-ASCII character appears twice.
 * - `\'hh` hex escapes, mapped through Windows-1252 (what `\ansi` documents
 *   mean, and what the smart quotes and dashes in real-world RTF are written
 *   as) rather than raw Latin-1.
 * - The break/whitespace control words (`\par`, `\line`, `\tab`, `\cell`,
 *   `\row`, `\sect`, `\page`) and the punctuation ones (`\emdash`, `\lquote`,
 *   …), so paragraphs and table cells land where the document put them.
 */

/** Control words whose entire group is document structure, not document text. */
const SKIPPED_DESTINATIONS: ReadonlySet<string> = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'listtext',
  'filetbl', 'revtbl', 'rsidtbl', 'xmlnstbl', 'protusertbl', 'latentstyles',
  'info', 'generator', 'themedata', 'colorschememapping', 'datastore',
  'pict', 'object', 'objdata', 'result', 'nonshppict', 'shppict', 'blipuid',
  // Page furniture: real text, but not the document body a preview shows
  // (the same scope `DocxPreview`'s own `mammoth` conversion draws).
  'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf',
])

/** Control words that end the current paragraph. */
const BREAKS: ReadonlySet<string> = new Set(['par', 'sect', 'page', 'row', 'nestrow', 'line'])

/** Control words that stand for one literal character. */
const LITERALS: Readonly<Record<string, string>> = {
  tab: '\t',
  cell: '\t',
  nestcell: '\t',
  emdash: '—',
  endash: '–',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  ltrmark: '‎',
  rtlmark: '‏',
  zwnj: '‌',
  zwj: '‍',
}

/** Windows-1252's own assignments for 0x80–0x9F, where it differs from Latin-1. */
const CP1252_HIGH: readonly string[] = [
  '€', '', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '', 'Ž', '',
  '', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '', 'ž', 'Ÿ',
]

/** One `\'hh` byte as a character, through Windows-1252. */
function fromAnsiByte(byte: number): string {
  if (byte >= 0x80 && byte <= 0x9F) {
    /* v8 ignore next -- the table covers the whole 0x80-0x9F range; the fallback only narrows the indexed-access type. */
    return CP1252_HIGH[byte - 0x80] ?? ''
  }
  return String.fromCharCode(byte)
}

/** Per-group scanner state, copied on `{` and restored on `}`. */
interface GroupState {
  /** Whether this group's text is being discarded (a skipped destination). */
  skip: boolean
  /** `\ucN`: how many characters after a `\uN` are its downlevel substitution. */
  unicodeSkip: number
}

/** Whether a character can appear in a control word's name. */
function isAlpha(char: string | undefined): boolean {
  return char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z'))
}

/** Whether a character is an ASCII digit. */
function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9'
}

/**
 * Extract an RTF document's text as paragraphs.
 *
 * Leading and trailing blank paragraphs are dropped and each paragraph's own
 * trailing whitespace is trimmed, since RTF writers pad both freely; interior
 * blank paragraphs are kept, because in a document they are deliberate spacing
 * a reader can see.
 * @param rtf - the file's decoded text (the RTF markup itself).
 * @returns the document's paragraphs in reading order; empty when it holds no text.
 */
export function extractRtfText(rtf: string): string[] {
  const paragraphs: string[] = []
  let current = ''
  const stack: GroupState[] = []
  let state: GroupState = { skip: false, unicodeSkip: 1 }
  /** Characters still to discard as a `\uN`'s downlevel substitution. */
  let pendingUnicodeSkip = 0

  /** Append text unless this group is skipped or a Unicode substitution is being dropped. */
  const emit = (text: string): void => {
    if (state.skip) return
    if (pendingUnicodeSkip > 0) {
      pendingUnicodeSkip--
      return
    }
    current += text
  }

  const endParagraph = (): void => {
    if (state.skip) return
    paragraphs.push(current.replace(/[ \t]+$/, ''))
    current = ''
  }

  for (let index = 0; index < rtf.length; index++) {
    const char = rtf[index]

    if (char === '{') {
      stack.push(state)
      state = { skip: state.skip, unicodeSkip: state.unicodeSkip }
      pendingUnicodeSkip = 0
      continue
    }
    if (char === '}') {
      const parent = stack.pop()
      if (parent !== undefined) state = parent
      pendingUnicodeSkip = 0
      continue
    }
    if (char !== '\\') {
      // Raw line breaks in the markup are insignificant in RTF — paragraphs
      // come from \par, never from the file's own line wrapping.
      if (char === '\n' || char === '\r') continue
      /* v8 ignore next -- `index < rtf.length` guards the loop; this narrows the indexed-access type. */
      emit(char ?? '')
      continue
    }

    // A backslash: a control word, a control symbol, or an escaped character.
    const next = rtf[index + 1]
    if (isAlpha(next)) {
      let end = index + 1
      while (isAlpha(rtf[end])) end++
      const word = rtf.slice(index + 1, end)
      let paramEnd = end
      if (rtf[paramEnd] === '-') paramEnd++
      while (isDigit(rtf[paramEnd])) paramEnd++
      const parameter = paramEnd > end ? Number(rtf.slice(end, paramEnd)) : undefined
      index = paramEnd - 1
      // One space directly after a control word is its delimiter, not text.
      if (rtf[paramEnd] === ' ') index = paramEnd

      if (SKIPPED_DESTINATIONS.has(word)) {
        state.skip = true
        continue
      }
      if (word === 'uc') {
        state.unicodeSkip = parameter ?? 1
        continue
      }
      if (word === 'u') {
        if (parameter !== undefined) {
          // RTF writes code points above 32767 as negative 16-bit values.
          emit(String.fromCodePoint(parameter < 0 ? parameter + 0x10000 : parameter))
          pendingUnicodeSkip = state.unicodeSkip
        }
        continue
      }
      if (BREAKS.has(word)) {
        endParagraph()
        continue
      }
      const literal = LITERALS[word]
      if (literal !== undefined) {
        emit(literal)
        continue
      }
      // Any other control word is formatting or a document property: it
      // contributes no text, and (unlike a skipped destination) its group's
      // remaining text is still document text.
      continue
    }

    if (next === '*') {
      // `{\*\foo …}`: an optional destination. Unrecognized ones must be
      // ignored outright, per the spec's own instruction to readers.
      state.skip = true
      index++
      continue
    }
    if (next === "'") {
      const hex = rtf.slice(index + 2, index + 4)
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        emit(fromAnsiByte(Number.parseInt(hex, 16)))
        index += 3
        continue
      }
      index++
      continue
    }
    if (next === '\\' || next === '{' || next === '}') {
      emit(next)
      index++
      continue
    }
    if (next === '~') {
      emit(' ')
      index++
      continue
    }
    if (next === '_') {
      emit('‑')
      index++
      continue
    }
    if (next === '-') {
      // An optional hyphen: a break opportunity, not a visible character.
      index++
      continue
    }
    if (next === '\n' || next === '\r') {
      // A backslash before a raw line break is how some writers spell \par.
      endParagraph()
      index++
      continue
    }
    // A lone backslash before anything else: nothing meaningful to emit.
  }

  if (current.trim() !== '') paragraphs.push(current.replace(/[ \t]+$/, ''))

  while (paragraphs.length > 0 && paragraphs[0]?.trim() === '') paragraphs.shift()
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1]?.trim() === '') paragraphs.pop()
  return paragraphs
}
