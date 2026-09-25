/**
 * `FilePreview`, fetched only once a file actually needs it.
 *
 * Same shape as the vendored engine's own `LazyPdfBody`/`LazyExcelBody`,
 * and for the same reason: the Office, PDF and spreadsheet bodies behind
 * `./FilePreview.tsx` are several megabytes of mammoth, pdfjs-dist, jszip
 * and xlsx, and a consumer that statically imports them pays for all of it
 * on every boot.
 *
 * That cost is almost never repaid in this repo's own bundle. With
 * `dsh-plugins-client-ui-document-host` composed in, the relocated preview
 * engine claims every `dsh-resource://file/**` address — including legacy
 * `.doc`/`.ppt`, which it converts Host-side and which this package has no
 * renderer for at all — so `FilePreview` is the *fallback* that renders
 * when no document seat is filled. Downloading megabytes eagerly to serve
 * the branch that usually does not run is the wrong way round.
 *
 * The chunk only becomes a separate file where the consuming bundle asks
 * for one: `clientPluginBundle`'s `codeSplitting` option. Without it
 * rolldown keeps the evaluation laziness (the bodies' top-level code still
 * runs only on first render) but packs the bytes back into the one entry,
 * which saves nothing on the wire.
 * @module dsh-plugins-client-ui-file-editing/LazyFilePreview
 */
import { lazy, Suspense, type ReactNode } from 'react'
import type { FilePreviewProps } from './FilePreview.tsx'

const LoadedFilePreview = lazy(async () => ({ default: (await import('./FilePreview.tsx')).FilePreview }))

/** `FilePreview`'s own props, plus what to show while its chunk is in flight. */
export type LazyFilePreviewProps = FilePreviewProps & {
  /**
   * Drawn while the chunk arrives. Supplied by the caller rather than
   * defaulted here, because this package owns no copy — every string it
   * renders is passed in.
   */
  readonly loading?: ReactNode
}

/**
 * Suspend while the preview chunk arrives, then draw it.
 * @param props - see {@link LazyFilePreviewProps}.
 * @returns the deferred preview.
 */
export function LazyFilePreview({ loading, ...props }: LazyFilePreviewProps): ReactNode {
  return (
    <Suspense fallback={loading ?? null}>
      <LoadedFilePreview {...props} />
    </Suspense>
  )
}
