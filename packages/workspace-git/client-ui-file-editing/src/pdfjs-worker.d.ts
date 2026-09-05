/**
 * `pdfjs-dist` ships no declaration file for this worker entry point (only
 * its main `pdfjs-dist` module is typed) — see `PdfPreview.tsx`'s own doc
 * comment for why this package imports it directly rather than pointing
 * `GlobalWorkerOptions.workerSrc` at a served copy of it.
 */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
