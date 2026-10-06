/**
 * What a previewed file *is*, without anything that draws it.
 *
 * These live apart from `./FilePreview.tsx` for one reason: that module
 * statically imports the Office, PDF and spreadsheet bodies, and through
 * them mammoth, pdfjs-dist, jszip and xlsx — several megabytes. A caller
 * that only needs to ask "is this text?" or "does this content disagree
 * with its extension?" must be able to do so without pulling any of that,
 * and tree-shaking cannot help: every one of those bodies imports a CSS
 * Module, whose generated module injects its stylesheet as a side effect,
 * so none of them is droppable.
 *
 * Re-exported from `./FilePreview.tsx` and from the package barrel, so this
 * split is invisible to callers that do not care about it.
 * @module dsh-plugins-client-ui-file-editing/kinds
 */
// Type-only: `./googleShortcut.ts` has no React/CSS graph of its own (plain
// JSON parsing and a few regexes), but the import stays type-only anyway so
// this module keeps its own "no runtime edge beyond what's defined here"
// discipline — see the doc comment above.
import type { GoogleShortcutKind } from './googleShortcut.ts'

export type { GoogleShortcutKind } from './googleShortcut.ts'

/**
 * Which body a file path selects (mirrors the caller's own extension
 * classification). `'pdf'`/`'docx'`/`'xlsx'`/`'pptx'` all parse the
 * caller-supplied raw bytes in-component (see this module's own doc comment);
 * the {@link FileTextKind} members are all plain text on disk and differ only
 * in what their body makes of that text. The three {@link GoogleShortcutKind}
 * members are a third shape again: a `.gdoc`/`.gsheet`/`.gslides` shortcut's
 * own bytes are plain JSON, but that JSON names a Google Doc/Sheet/Slide
 * rather than holding its content — see {@link isGoogleShortcutKind}.
 */
export type FilePreviewKind = FileTextKind | 'image' | 'external' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | GoogleShortcutKind

/**
 * Kinds whose content is text, and which a caller may therefore edit
 * (`FileEditor`), diff (`SideBySideDiff`), and copy as-is. They differ only in
 * what their *preview* makes of that text: a line-numbered highlighted view
 * (`'text'`), rendered Markdown, a serialization-detected ontology view
 * (`'ontology'`), a table (`'delimited'`, for `.csv`/`.tsv`), or an RTF
 * document's extracted text (`'rtf'`). A caller gating an affordance on "is
 * this text" should test {@link isTextKind} rather than enumerate, so that a
 * kind added here is not silently left out of Edit.
 */
export type FileTextKind = 'text' | 'markdown' | 'ontology' | 'delimited' | 'rtf'

/** The {@link FileTextKind} members, behind {@link isTextKind}. */
const TEXT_KINDS: ReadonlySet<FilePreviewKind> = new Set<FileTextKind>([
  'text', 'markdown', 'ontology', 'delimited', 'rtf',
])

/**
 * Whether a kind's content is text — see {@link FileTextKind}.
 * @param kind - the classified viewer kind.
 * @returns whether the kind is one of the text kinds.
 */
export function isTextKind(kind: FilePreviewKind): kind is FileTextKind {
  return TEXT_KINDS.has(kind)
}

/** The {@link GoogleShortcutKind} members, behind {@link isGoogleShortcutKind}. */
const GOOGLE_SHORTCUT_KINDS: ReadonlySet<FilePreviewKind> = new Set<GoogleShortcutKind>(['gdoc', 'gsheet', 'gslides'])

/**
 * Whether a kind is one of the three Google Drive shortcut kinds
 * (`.gdoc`/`.gsheet`/`.gslides` — see `./googleShortcut.ts`'s own doc
 * comment for what these files are). Edited and previewed like a
 * {@link FileTextKind} — the same `canEdit`/Edit-mode toggle applies — but
 * through a different editor (`GoogleDocEditor`, Google's own embedded
 * editor, over `FileEditor`'s raw-text CodeMirror buffer), which is why
 * these are deliberately NOT members of {@link FileTextKind}: they are
 * never diffed (there is no meaningful text diff over a shortcut's own
 * pointer JSON), and "editing" one never touches this app's own
 * write/autosave pipeline — Google's own servers persist the edit the
 * moment it happens, same as using docs.google.com directly.
 * @param kind - the classified viewer kind.
 * @returns whether the kind is one of the three Google shortcut kinds.
 */
export function isGoogleShortcutKind(kind: FilePreviewKind): kind is GoogleShortcutKind {
  return GOOGLE_SHORTCUT_KINDS.has(kind)
}

/** Fetch/decode outcome for the currently previewed path, caller-resolved. */
export type FilePreviewState =
  | { phase: 'loading' }
  | {
    phase: 'ready'
    content:
      | { kind: 'text'; text: string }
      | { kind: 'binary'; blobUrl: string | null }
      | { kind: 'bytes'; data: ArrayBuffer }
  }
  | { phase: 'too-large'; maxBytes: number }
  | { phase: 'error' }

/** Kinds whose ready content is expected as a caller-decoded blob URL (`image` only). */
const BLOB_KINDS: ReadonlySet<FilePreviewKind> = new Set(['image'])

/** Kinds whose ready content is expected as caller-decoded raw bytes, for this component's own in-browser PDF/Office parsers. */
const BYTES_KINDS: ReadonlySet<FilePreviewKind> = new Set(['pdf', 'docx', 'xlsx', 'pptx'])

/**
 * Whether a ready state's actual content kind disagrees with what the
 * classified `kind` expects — a mismatched extension on real binary
 * content (a `text`/`markdown` kind whose bytes weren't valid UTF-8, so the
 * caller could only decode `binary`/`bytes`), or the reverse (an
 * `image`/`pdf`/Office kind whose bytes happened to decode as UTF-8 text).
 * Exported so callers computing their own footer affordances (e.g. an "Open
 * with default app" fallback, or a plain-text Copy button) agree with this
 * component's own body notice without re-deriving the rule.
 * @param kind - the classified viewer kind.
 * @param state - the fetch/decode state.
 * @returns whether the ready content's kind disagrees with `kind`'s expectation.
 */
export function isContentMismatch(kind: FilePreviewKind, state: FilePreviewState): boolean {
  if (state.phase !== 'ready' || kind === 'external') return false
  const actual = state.content.kind
  if (BLOB_KINDS.has(kind)) return actual !== 'binary'
  if (BYTES_KINDS.has(kind)) return actual !== 'bytes'
  return actual !== 'text' // every FileTextKind
}
