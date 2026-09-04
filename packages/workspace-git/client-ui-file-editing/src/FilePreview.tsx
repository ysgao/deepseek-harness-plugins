/**
 * Shared file-content preview body: text/code (line-numbered, syntax-
 * highlighted through `ReadBlock`), Markdown (rendered through
 * `MarkdownText`), an image (a caller-supplied blob URL shown inline), a
 * PDF (the same blob URL handed to the browser's own built-in viewer
 * through an `<iframe>` — no bundled PDF renderer), or one of three Office
 * formats read from the caller-supplied raw bytes: `.docx` (`DocxPreview`,
 * via `mammoth`), `.xlsx`/legacy `.xls` (`XlsxPreview`, via `xlsx`/SheetJS),
 * and `.pptx` text-only extraction (`PptxPreview`, via `jszip`). Legacy
 * binary `.doc`/`.ppt` (pre-2007 OLE compound-file format) have no
 * client-side parser available and never classify to one of these kinds in
 * the first place — see the consuming packages' own `classify.ts`. Every
 * other kind — external (unrecognized extension), too-large, error, or a
 * ready read whose content disagrees with what the classified kind expects
 * (a mismatched extension, e.g. real binary content behind a `.txt`
 * extension, or the reverse) — renders a one-line notice via
 * {@link isContentMismatch}. Pure presentation: the caller resolves its own
 * fetch/classify concepts (workspace file read, tool read result, or any
 * other file source) into {@link FilePreviewState} and
 * {@link FilePreviewKind} before rendering this component, so it carries no
 * host- or domain-specific vocabulary (no wire error types, no workspace
 * RPC shapes) — the Office parsers above are the one exception, reading the
 * caller's raw bytes directly, since that parsing is itself presentation
 * (the same role `ReadBlock`'s own shiki highlighting or `MarkdownText`'s
 * own rendering already play for the other kinds).
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText, ReadBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, ReadBlockLabels, ReadBlockLine } from '@deepseek-ai/dsh-client-ui-primitives'
import { DocxPreview } from './DocxPreview.tsx'
import { PptxPreview } from './PptxPreview.tsx'
import { XlsxPreview } from './XlsxPreview.tsx'
import css from './FilePreview.module.css'

/** Localized chrome for whichever body {@link FilePreview} renders. */
export interface FilePreviewLabels {
  markdown: MarkdownLabels
  read: ReadBlockLabels
}

/**
 * Which body a file path selects (mirrors the caller's own extension
 * classification). `'pdf'` renders the browser's own built-in PDF viewer
 * over a caller-supplied blob URL; `'docx'`/`'xlsx'`/`'pptx'` parse the
 * caller-supplied raw bytes in-component (see this module's own doc comment).
 */
export type FilePreviewKind = 'markdown' | 'image' | 'text' | 'external' | 'pdf' | 'docx' | 'xlsx' | 'pptx'

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

/** Kinds whose ready content is expected as a caller-decoded blob URL (`image`, or the browser's own PDF viewer). */
const BLOB_KINDS: ReadonlySet<FilePreviewKind> = new Set(['image', 'pdf'])

/** Kinds whose ready content is expected as caller-decoded raw bytes, for this component's own in-browser Office parsers. */
const BYTES_KINDS: ReadonlySet<FilePreviewKind> = new Set(['docx', 'xlsx', 'pptx'])

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
  return actual !== 'text' // 'text' | 'markdown'
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
  /** Image `alt` text; defaults to `path` (a caller wanting just the basename passes it explicitly). Also the PDF `<iframe>` title. */
  imageAlt?: string | undefined
  /** Localized chrome for the Markdown and text/code bodies; unused for the other kinds. */
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

/** Split text into `ReadBlock` lines, 1-based file line numbers. Shared with `FileEditor`'s own live syntax-highlighted preview pane. */
export function toReadBlockLines(text: string): ReadBlockLine[] {
  // A trailing newline must not manufacture a phantom empty final line: a
  // file ending in "\n" splits to N lines of real content, not N+1.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  if (body === '') return []
  return body.split('\n').map((line, index) => ({ number: index + 1, text: line }))
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
  } else if (kind === 'pdf') {
    const blobUrl = state.content.kind === 'binary' ? state.content.blobUrl : null
    body = blobUrl === null
      ? <p className={css.notice}>{loadingLabel}</p>
      : <iframe className={css.pdf} src={blobUrl} title={imageAlt ?? path} />
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
