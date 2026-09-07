/**
 * Shared file-content preview body: text/code (line-numbered, syntax-
 * highlighted through `ReadBlock`), Markdown (rendered through
 * `MarkdownText`), an OWL/RDF ontology (`OntologyPreview`, which picks its own
 * highlighting from the file's own serialization — see that component's doc
 * comment), delimiter-separated text as a table (`DelimitedPreview`, for
 * `.csv`/`.tsv`), an `.rtf` document's extracted text (`RtfPreview`), an
 * image (a caller-supplied blob URL shown inline), or one
 * of four formats read from the caller-supplied raw bytes: PDF (`PdfPreview`,
 * via `pdfjs-dist` — deliberately not the browser's own built-in PDF viewer;
 * see that component's own doc comment for why), `.docx` (`DocxPreview`, via
 * `mammoth`), `.xlsx`/legacy `.xls` (`XlsxPreview`, via `xlsx`/SheetJS), and
 * `.pptx` text-only extraction (`PptxPreview`, via `jszip`). Legacy binary
 * `.doc`/`.ppt` (pre-2007 OLE compound-file format) have no client-side
 * parser available and never classify to one of these kinds in the first
 * place — see the consuming packages' own `classify.ts`. Every other kind —
 * external (unrecognized extension), too-large, error, or a ready read whose
 * content disagrees with what the classified kind expects (a mismatched
 * extension, e.g. real binary content behind a `.txt` extension, or the
 * reverse) — renders a one-line notice via {@link isContentMismatch}. Pure
 * presentation: the caller resolves its own fetch/classify concepts
 * (workspace file read, tool read result, or any other file source) into
 * {@link FilePreviewState} and {@link FilePreviewKind} before rendering this
 * component, so it carries no host- or domain-specific vocabulary (no wire
 * error types, no workspace RPC shapes) — the PDF/Office parsers above are
 * the one exception, reading the caller's raw bytes directly, since that
 * parsing is itself presentation (the same role `ReadBlock`'s own shiki
 * highlighting or `MarkdownText`'s own rendering already play for the other
 * kinds).
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText, ReadBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, ReadBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { DelimitedPreview } from './DelimitedPreview.tsx'
import { DocxPreview } from './DocxPreview.tsx'
import { toReadBlockLines } from './lines.ts'
import { OntologyPreview } from './OntologyPreview.tsx'
import { PdfPreview } from './PdfPreview.tsx'
import { PptxPreview } from './PptxPreview.tsx'
import { RtfPreview } from './RtfPreview.tsx'
import { XlsxPreview } from './XlsxPreview.tsx'
import css from './FilePreview.module.css'

/**
 * Localized chrome for the text-kind bodies — the ones both this component
 * and `FileEditor`'s live preview pane render, which is why both take exactly
 * this one object. The byte-kind bodies' own labels (`xlsx*`, `pptx*`) are
 * flat props on {@link FilePreviewProps} instead: a `.xlsx` or `.pptx` is
 * never editable, so those labels never reach the editor and would only be
 * dead weight in its signature.
 */
export interface FilePreviewLabels {
  markdown: MarkdownLabels
  read: ReadBlockLabels
  /** `DelimitedPreview`'s notices; unused by every other kind. */
  delimited: DelimitedLabels
  /** `RtfPreview`'s notices; unused by every other kind. */
  rtf: RtfLabels
}

/** `DelimitedPreview`'s own two notices. */
export interface DelimitedLabels {
  /** Truncation notice, given the file's own full (pre-bound) row and column counts. */
  truncated: (rows: number, cols: number) => string
  /** Empty-file notice (no rows at all). */
  empty: string
}

/** `RtfPreview`'s own two notices. */
export interface RtfLabels {
  /** Truncation notice, given the shown and total paragraph counts. */
  truncated: (shown: number, total: number) => string
  /** Empty-document notice (no extractable text). */
  empty: string
}

/**
 * Which body a file path selects (mirrors the caller's own extension
 * classification). `'pdf'`/`'docx'`/`'xlsx'`/`'pptx'` all parse the
 * caller-supplied raw bytes in-component (see this module's own doc comment);
 * the {@link FileTextKind} members are all plain text on disk and differ only
 * in what their body makes of that text.
 */
export type FilePreviewKind = FileTextKind | 'image' | 'external' | 'pdf' | 'docx' | 'xlsx' | 'pptx'

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

export interface FilePreviewProps {
  /** Display path (ReadBlock's banner label; also the image/PDF `alt`/`title` text unless `imageAlt` overrides it). */
  path: string
  /** Which body renders the content — see {@link FilePreviewKind}. */
  kind: FilePreviewKind
  /** Fetch/decode state; ignored while `kind === 'external'` (the caller need not fetch at all). */
  state: FilePreviewState
  /** shiki grammar hint for the text body; unknown or absent renders plain monospace. */
  lang?: string | undefined
  /** Image `alt` text; defaults to `path` (a caller wanting just the basename passes it explicitly). */
  imageAlt?: string | undefined
  /** Localized chrome for the text-kind bodies; unused for the image and byte kinds. */
  labels: FilePreviewLabels
  loadingLabel: string
  loadErrorLabel: string
  externalLabel: string
  tooLargeLabel: (maxMB: number) => string
  /** `XlsxPreview`'s truncation notice, given a too-large sheet's own full row/column counts; unused for other kinds. */
  xlsxTruncatedLabel: (rows: number, cols: number) => string
  /** `XlsxPreview`'s empty-workbook notice; unused for other kinds. */
  xlsxEmptyLabel: string
  /** `PptxPreview`'s per-slide heading, given its 1-based position; unused for other kinds. */
  pptxSlideLabel: (index: number) => string
  /** `PptxPreview`'s empty-deck notice; unused for other kinds. */
  pptxEmptyLabel: string
  /** Extra class merged onto the scrolling body wrapper. */
  className?: string | undefined
}

/**
 * Render the file-preview body for the resolved kind and fetch state.
 * @param props - see {@link FilePreviewProps}.
 * @returns the body element (a notice, a rendered image/PDF/Office body, Markdown, or a `ReadBlock`).
 */
export function FilePreview({
  path, kind, state, lang, imageAlt, labels, loadingLabel, loadErrorLabel, externalLabel, tooLargeLabel,
  xlsxTruncatedLabel, xlsxEmptyLabel, pptxSlideLabel, pptxEmptyLabel, className,
}: FilePreviewProps) {
  // A ready read whose content disagrees with what the classified kind
  // expects (a mismatched extension) falls back the same way an
  // over-the-bound file or a genuinely external kind does.
  const mismatch = isContentMismatch(kind, state)

  const lines = useMemo(() => {
    if (kind !== 'text' || state.phase !== 'ready' || state.content.kind !== 'text') return null
    return toReadBlockLines(state.content.text)
  }, [kind, state])

  let body: ReactNode
  if (kind === 'external') {
    body = <p className={css.notice}>{externalLabel}</p>
  } else if (state.phase === 'loading') {
    body = <p className={css.notice}>{loadingLabel}</p>
  } else if (state.phase === 'error' || mismatch) {
    body = <p className={css.notice} role="alert">{loadErrorLabel}</p>
  } else if (state.phase === 'too-large') {
    body = <p className={css.notice} role="alert">{tooLargeLabel(Math.round(state.maxBytes / (1024 * 1024)))}</p>
  } else if (kind === 'image') {
    const blobUrl = state.content.kind === 'binary' ? state.content.blobUrl : null
    body = blobUrl === null
      ? <p className={css.notice}>{loadingLabel}</p>
      : <img className={css.image} src={blobUrl} alt={imageAlt ?? path} />
  } else if (kind === 'pdf' && state.content.kind === 'bytes') {
    body = <PdfPreview data={state.content.data} loadingLabel={loadingLabel} loadErrorLabel={loadErrorLabel} />
  } else if (kind === 'docx' && state.content.kind === 'bytes') {
    body = <DocxPreview data={state.content.data} loadingLabel={loadingLabel} loadErrorLabel={loadErrorLabel} />
  } else if (kind === 'xlsx' && state.content.kind === 'bytes') {
    body = (
      <XlsxPreview
        data={state.content.data}
        loadingLabel={loadingLabel}
        loadErrorLabel={loadErrorLabel}
        truncatedLabel={xlsxTruncatedLabel}
        emptyLabel={xlsxEmptyLabel}
      />
    )
  } else if (kind === 'pptx' && state.content.kind === 'bytes') {
    body = (
      <PptxPreview
        data={state.content.data}
        loadingLabel={loadingLabel}
        loadErrorLabel={loadErrorLabel}
        slideLabel={pptxSlideLabel}
        emptyLabel={pptxEmptyLabel}
      />
    )
  } else if (kind === 'ontology' && state.content.kind === 'text') {
    body = <OntologyPreview path={path} text={state.content.text} labels={labels.read} />
  } else if (kind === 'delimited' && state.content.kind === 'text') {
    body = (
      <DelimitedPreview
        path={path}
        text={state.content.text}
        truncatedLabel={labels.delimited.truncated}
        emptyLabel={labels.delimited.empty}
      />
    )
  } else if (kind === 'rtf' && state.content.kind === 'text') {
    body = (
      <RtfPreview
        text={state.content.text}
        truncatedLabel={labels.rtf.truncated}
        emptyLabel={labels.rtf.empty}
      />
    )
  } else if (kind === 'markdown' && state.content.kind === 'text') {
    body = <MarkdownText text={state.content.text} labels={labels.markdown} />
  } else {
    // Reached only for kind === 'text' with a text read: every other
    // combination above either has its own branch or was already routed
    // through the mismatch notice, so `lines` is non-null here.
    /* v8 ignore next -- the false arm is unreachable per the comment above; only TypeScript's narrowing needs it. */
    body = <ReadBlock label={path} lines={lines ?? []} totalLines={(lines ?? []).length} lang={lang} labels={labels.read} />
  }

  return <div className={className ?? css.body}>{body}</div>
}
