/**
 * Read-only `.docx` body: converts the file's raw bytes to HTML through
 * `mammoth` (Open XML paragraph/heading/list/table structure, not a
 * pixel-faithful render of the original page layout — headers/footers,
 * fonts, and page breaks are out of scope for both `mammoth` and this
 * preview), then renders that HTML after sanitizing it through `DOMPurify`.
 * Sanitizing is required, not defense-in-depth: `mammoth`'s own output can
 * embed images as `data:` URLs it read from the document, but the input
 * bytes are still an arbitrary file on disk, and this component's caller
 * (`FilePreview`) has no way to have already validated `mammoth`'s output
 * against injected markup a crafted `.docx` might trigger through it.
 * Legacy binary `.doc` (pre-2007 OLE compound-file format) is out of scope
 * for `mammoth` itself, not just this component — that extension never
 * classifies to `kind: 'docx'` in the first place (see the consuming
 * package's own `classify.ts`).
 */
import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { convertToHtml } from 'mammoth'
import css from './DocxPreview.module.css'

/** Parse outcome for the currently previewed `.docx` bytes. */
type DocxParseState =
  | { phase: 'parsing' }
  | { phase: 'ready'; html: string }
  | { phase: 'error' }

export interface DocxPreviewProps {
  /** The file's raw bytes, as read by the caller (base64-decoded, undecoded further). */
  data: ArrayBuffer
  loadingLabel: string
  loadErrorLabel: string
}

/**
 * Render one `.docx` file's converted HTML.
 * @param props - see {@link DocxPreviewProps}.
 * @returns a loading/error notice while parsing, then the sanitized converted body.
 */
export function DocxPreview({ data, loadingLabel, loadErrorLabel }: DocxPreviewProps) {
  const [state, setState] = useState<DocxParseState>({ phase: 'parsing' })

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'parsing' })
    convertToHtml({ arrayBuffer: data }).then((result) => {
      if (cancelled) return
      setState({ phase: 'ready', html: DOMPurify.sanitize(result.value) })
    }).catch(() => {
      if (cancelled) return
      setState({ phase: 'error' })
    })
    return () => { cancelled = true }
  }, [data])

  if (state.phase === 'parsing') return <p className={css.notice}>{loadingLabel}</p>
  if (state.phase === 'error') return <p className={css.notice} role="alert">{loadErrorLabel}</p>
  // Sanitized immediately above through DOMPurify — the one deliberate
  // dangerouslySetInnerHTML use in this package, and only for this reason.
  return <div className={css.doc} dangerouslySetInnerHTML={{ __html: state.html }} />
}
