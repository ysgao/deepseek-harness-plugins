/**
 * Read-only PDF body: renders every page onto its own `<canvas>` via
 * `pdfjs-dist`, replacing the browser's own built-in PDF viewer previously
 * embedded through an `<iframe src="blob:...">`. That viewer's availability
 * depends on a setting this component's caller cannot see or control —
 * Chrome's own "Download PDFs instead of automatically opening them" turns
 * the embed into a non-functional placeholder (a generic icon, the blob
 * URL's own opaque UUID standing in for a filename, and an "Open" button
 * that just re-triggers the same failed embed) instead of the page content —
 * so this preview no longer depends on the browser's PDF plugin at all.
 *
 * Runs entirely on the main thread: pdf.js normally offloads parsing to a
 * background Worker loaded from a separate script URL, which this package's
 * build has no established asset-bundling story for (unlike `mammoth`/
 * `xlsx`/`jszip`, which run synchronously in-thread with no worker of their
 * own). Statically importing the worker module and handing it to pdf.js as
 * `globalThis.pdfjsWorker` makes pdf.js's own `PDFWorker` skip constructing a
 * real background Worker and instead pipe messages to this in-process copy —
 * the same "fake worker" fallback pdf.js itself uses in environments with no
 * Worker support, deliberately forced here so no separate worker asset needs
 * bundling or serving.
 */
import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs'
import css from './PdfPreview.module.css'

// One-time global wiring — see this module's own doc comment. `??=` keeps a
// second `PdfPreview` mount (or a hot remount) from clobbering the same
// assignment.
;(globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker ??= pdfjsWorker

/** Render scale for page canvases: sharp enough for on-screen reading (and a modest zoom) without ballooning canvas memory for a large page. */
const RENDER_SCALE = 1.5

/** Parse/render outcome for the currently previewed PDF bytes. */
type PdfState =
  | { phase: 'loading' }
  | { phase: 'ready'; pageCount: number }
  | { phase: 'error' }

export interface PdfPreviewProps {
  /** The file's raw bytes, as read by the caller (base64-decoded, undecoded further). */
  data: ArrayBuffer
  loadingLabel: string
  loadErrorLabel: string
}

/**
 * Render one PDF file's pages as a stacked column of canvases.
 * @param props - see {@link PdfPreviewProps}.
 * @returns a loading/error notice while the document opens, then one canvas per page.
 */
export function PdfPreview({ data, loadingLabel, loadErrorLabel }: PdfPreviewProps) {
  const [state, setState] = useState<PdfState>({ phase: 'loading' })
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([])
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  // Opens the document and flips to `'ready'` once it knows the page count.
  // Deliberately does NOT render pages itself: `setState` here doesn't
  // synchronously mount the `'ready'` state's canvases, so `canvasesRef`
  // would still be empty for every page if this effect tried to render them
  // in the same pass — see the second effect below, which runs only once
  // React has actually committed those canvases to the DOM.
  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    canvasesRef.current = []
    docRef.current = null
    // A copy, not the caller's own buffer: pdf.js's own worker plumbing may
    // transfer (detach) whatever ArrayBuffer it's handed, and the caller may
    // still hold this same buffer in its own state.
    const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) })
    loadingTask.promise.then((doc) => {
      // A cancelled load (unmount, or `data` changed) has already had its
      // teardown done by this effect's own cleanup below, via
      // `loadingTask.destroy()` — `PDFDocumentProxy` itself exposes no
      // public `destroy()` of its own to call here.
      if (cancelled) return
      docRef.current = doc
      setState({ phase: 'ready', pageCount: doc.numPages })
    }).catch(() => {
      if (cancelled) return
      setState({ phase: 'error' })
    })
    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
  }, [data])

  // Renders each page onto its own canvas once the `'ready'` state's
  // canvases actually exist in the DOM (this effect runs after React commits
  // the render that created them, so `canvasesRef.current` is populated by
  // then — unlike doing this inline right after the `setState` above).
  useEffect(() => {
    if (state.phase !== 'ready') return
    const doc = docRef.current
    if (doc === null) return
    let cancelled = false
    void (async () => {
      // Rendered sequentially, one page at a time, mirroring `PptxPreview`'s
      // own per-slide loop — pdf.js's own canvas renderer is not meant to
      // run many pages of the same document concurrently.
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        if (cancelled) return
        const canvas = canvasesRef.current[pageNumber - 1]
        if (canvas === null || canvas === undefined) continue
        try {
          const page = await doc.getPage(pageNumber)
          if (cancelled) return
          const viewport = page.getViewport({ scale: RENDER_SCALE })
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
          await page.render({ canvas, viewport }).promise
        } catch {
          // One page's own render failure (a corrupt page in an otherwise
          // valid document) leaves that canvas blank rather than failing
          // the whole preview.
        }
      }
    })()
    return () => { cancelled = true }
  }, [state])

  if (state.phase === 'loading') return <p className={css.notice}>{loadingLabel}</p>
  if (state.phase === 'error') return <p className={css.notice} role="alert">{loadErrorLabel}</p>

  return (
    <div className={css.root}>
      {Array.from({ length: state.pageCount }, (_, index) => (
        // eslint-disable-next-line react/no-array-index-key -- pages have no stable identity beyond position; the document is read-only and never reorders.
        <canvas key={index} ref={(el) => { canvasesRef.current[index] = el }} className={css.page} />
      ))}
    </div>
  )
}
