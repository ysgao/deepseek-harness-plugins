/**
 * In-app preview modal for one Workspace file: a thin wrapper around the
 * shared `FilePreview` body (text/code, Markdown, OWL/RDF ontology,
 * `.csv`/`.tsv` table, `.rtf` document, image, PDF, and the three supported
 * Office formats — see `dsh-plugins-client-ui-file-editing`'s own doc comment)
 * plus this dialog's own chrome (title, close, and the
 * "Open with default app"/"Copy" footer action). A file whose classified
 * kind disagrees with the Host's own UTF-8 decode (a mismatched extension
 * on real binary content), and a file whose read fails with
 * `file-too-large`, both fall back to the "Open with default app" footer
 * action wired to `openPath` (the Host OS-default handoff, the same
 * primitive the Files tree used before this viewer existed) — same as a
 * genuinely `external`-kind (unrecognized extension, or a legacy binary
 * `.doc`/`.ppt`) file.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceFileContent } from 'dsh-plugins-api-workspace-file-controller/types'
import { FilePreview, isContentMismatch, isTextKind } from 'dsh-plugins-client-ui-file-editing'
import type { FilePreviewLabels, FilePreviewState } from 'dsh-plugins-client-ui-file-editing'
import { langFromPath, viewerKindFor } from './classify.ts'
import css from './FileViewer.module.css'

/** The standard locale seat this viewer consumes (this package's own `workspace-files` namespace). */
type FileViewerTranslate = TranslateNS<'workspace-files'>

export interface FileViewerProps {
  /** The file to preview; the dialog is open exactly while this is set. */
  path: string | null
  /** Read the file's content (workspace-scoped, size-bounded on the Host). */
  readFile: (path: string, signal?: AbortSignal) => Promise<WorkspaceFileContent>
  /** Open the file with the Host OS default application. */
  openPath: (path: string) => Promise<void>
  /** Close the preview (mask, Escape, close control, or the external-open action). */
  onClose: () => void
  t: FileViewerTranslate
}

/** Basename of a path for the dialog title, both separators accepted. */
function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path
}

/**
 * Decode base64 wire bytes to a revocable blob URL, for the `image` body's
 * inline `<img>`; null input yields no URL. Named via a `File` (not a bare
 * `Blob`) so a right-click "Save Image As" (or any other consumer of the URL
 * that looks past its own opaque `blob:...` path) offers the file's real
 * name.
 */
function useBlobUrl(base64: string | null, mediaType: string | undefined, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (base64 === null || mediaType === undefined || path === null) {
      setUrl(null)
      return
    }
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const created = URL.createObjectURL(new File([bytes], basename(path), { type: mediaType }))
    setUrl(created)
    return () => { URL.revokeObjectURL(created) }
  }, [base64, mediaType, path])
  return url
}

/** Fetch state for the currently previewed path (the Host's own two-way text/binary decode, undecoded further). */
type FetchState =
  | { phase: 'loading' }
  | { phase: 'ready'; content: WorkspaceFileContent }
  | { phase: 'too-large'; maxBytes: number }
  | { phase: 'error' }

/**
 * Resolve one readFile rejection into the state its cause distinguishes.
 * Discriminates by `code`, never `instanceof` — {@link remoteErrorOf}'s own
 * contract, since a RemoteError rebuilt on this Client face is not the same
 * class instance the Host threw.
 */
function stateFromError(error: unknown): FetchState {
  const failure = remoteErrorOf(error)
  if (failure?.code === 'workspace-files/file-too-large') return { phase: 'too-large', maxBytes: failure.details.maxBytes }
  return { phase: 'error' }
}

/**
 * Render the file-preview dialog.
 * @param props - see {@link FileViewerProps}.
 * @returns the dialog element (renders nothing while `path` is null, via `Modal`).
 */
export function FileViewer({ path, readFile, openPath, onClose, t }: FileViewerProps) {
  const [state, setState] = useState<FetchState>({ phase: 'loading' })
  const kind = useMemo(() => (path === null ? 'external' : viewerKindFor(path)), [path])

  useEffect(() => {
    if (path === null) return
    setState({ phase: 'loading' })
    // External-viewer files (unrecognized extensions, or a legacy binary
    // .doc/.ppt with no client-side parser) never fetch content at all: the
    // dialog's only action is the OS handoff.
    if (viewerKindFor(path) === 'external') return
    const controller = new AbortController()
    readFile(path, controller.signal).then((content) => {
      if (controller.signal.aborted) return
      setState({ phase: 'ready', content })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setState(stateFromError(error))
    })
    return () => { controller.abort() }
  }, [path, readFile])

  const filePreviewLabels: FilePreviewLabels = useMemo(() => ({
    markdown: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('files.viewer.footnotes') },
    read: {
      // ReadBlockLabels extends CodeToolbarLabels as of vendor pin 477b4f42;
      // these three are the toolbar's own copy, from the shared namespace the
      // rest of this block already reads.
      codeLabel: t('codeBlock.title'),
      wrapLabel: t('codeBlock.wrap'),
      unwrapLabel: t('codeBlock.unwrap'),
      window: (shown, total) => t('files.viewer.read.window', { shown, total }),
      copy: t('copy'),
      copied: t('copied'),
      collapseAria: t('files.viewer.read.collapseAria'),
      expandAria: count => t('files.viewer.read.expandAria', { count }),
      collapse: t('collapse'),
      expand: count => t('files.viewer.read.expand', { count }),
    },
    delimited: {
      truncated: (rows, cols) => t('files.viewer.delimitedTruncated', { rows, cols }),
      empty: t('files.viewer.delimitedEmpty'),
    },
    rtf: {
      truncated: (shown, total) => t('files.viewer.rtfTruncated', { shown, total }),
      empty: t('files.viewer.rtfEmpty'),
    },
  }), [t])

  const binaryBase64 = state.phase === 'ready' && state.content.kind === 'binary' ? state.content.data : null
  const binaryMediaType = state.phase === 'ready' && state.content.kind === 'binary' ? state.content.mediaType : undefined
  const blobUrl = useBlobUrl(kind === 'image' ? binaryBase64 : null, binaryMediaType, path)
  // Pure decode, unlike the blob URL above: raw bytes create no browser
  // resource needing an effect/cleanup lifecycle, so a plain `useMemo` is
  // enough for the PDF/Office kinds' own in-component parsers.
  const bytes = useMemo(() => {
    if (kind !== 'pdf' && kind !== 'docx' && kind !== 'xlsx' && kind !== 'pptx') return null
    if (binaryBase64 === null) return null
    const binary = atob(binaryBase64)
    return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer
  }, [kind, binaryBase64])

  // Reshapes this dialog's own Host-shaped `FetchState` into the generic
  // `FilePreviewState` the shared `FilePreview` body expects — a `text`
  // read passes through as-is; a `binary` read resolves to whichever of
  // `FilePreview`'s own three ready-content shapes `kind` expects (a blob
  // URL for `image`, raw bytes for the PDF/Office kinds, or the `binary`
  // shape itself as a deliberate mismatch fallback for every other kind).
  const previewState: FilePreviewState = useMemo(() => {
    if (state.phase === 'loading') return { phase: 'loading' }
    if (state.phase === 'too-large') return { phase: 'too-large', maxBytes: state.maxBytes }
    if (state.phase === 'error') return { phase: 'error' }
    if (state.content.kind === 'text') return { phase: 'ready', content: { kind: 'text', text: state.content.content } }
    if (kind === 'image') return { phase: 'ready', content: { kind: 'binary', blobUrl } }
    if (kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
      return bytes === null
        ? { phase: 'loading' }
        : { phase: 'ready', content: { kind: 'bytes', data: bytes } }
    }
    return { phase: 'ready', content: { kind: 'binary', blobUrl: null } }
  }, [state, kind, blobUrl, bytes])

  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | undefined>(undefined)

  // A fast unmount right after a copy must not let the pending timer call
  // setState on an unmounted component. Closing the modal itself does NOT
  // unmount this component — `FilesNode` renders it unconditionally and
  // only clears `path` (see this file's own early `path === null` return)
  // — the real trigger is `FilesNode` itself unmounting (its owning
  // Workspace group collapsing or being removed from the sidebar).
  useEffect(() => () => { window.clearTimeout(copiedTimerRef.current) }, [])

  const onCopy = (text: string): void => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }

  if (path === null) return null

  const showsExternalOnly = kind === 'external' || state.phase === 'error' || state.phase === 'too-large' || isContentMismatch(kind, previewState)

  const footer = showsExternalOnly
    ? (
      <Button variant="outline" onClick={() => { void openPath(path); onClose() }}>
        {t('files.viewer.openExternally')}
      </Button>
    )
    // Copy hands over the file's own raw text, so it applies to every text
    // kind whatever its body renders — Markdown included: `MarkdownText`'s own
    // per-block copy controls only cover the code fences inside a rendered
    // document, never the document's own source, which is what this offers.
    : state.phase === 'ready' && state.content.kind === 'text' && isTextKind(kind)
      ? (
        <Button
          variant="outline"
          onClick={() => {
            /* v8 ignore next -- narrowing guard: the outer ternary already required state.content.kind === 'text' to reach this button. */
            if (state.content.kind === 'text') onCopy(state.content.content)
          }}
        >
          {copied ? t('files.viewer.copied') : t('files.viewer.copy')}
        </Button>
      )
      : undefined

  return (
    <Modal open onClose={onClose} title={basename(path)} closeLabel={t('files.viewer.close')} footer={footer}>
      <FilePreview
        className={css.body}
        path={path}
        kind={kind}
        state={previewState}
        lang={langFromPath(path)}
        imageAlt={basename(path)}
        labels={filePreviewLabels}
        loadingLabel={t('files.viewer.loading')}
        loadErrorLabel={t('files.viewer.loadError')}
        externalLabel={t('files.viewer.openExternally')}
        tooLargeLabel={maxMB => t('files.viewer.tooLarge', { maxMB })}
        xlsxTruncatedLabel={(rows, cols) => t('files.viewer.xlsxTruncated', { rows, cols })}
        xlsxEmptyLabel={t('files.viewer.xlsxEmpty')}
        pptxSlideLabel={index => t('files.viewer.pptxSlide', { index })}
        pptxEmptyLabel={t('files.viewer.pptxEmpty')}
      />
    </Modal>
  )
}
