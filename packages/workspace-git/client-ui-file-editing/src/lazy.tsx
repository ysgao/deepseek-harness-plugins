/**
 * The file bodies, fetched only once something actually needs one.
 *
 * Same shape as the vendored preview engine's own `LazyPdfBody`/
 * `LazyExcelBody`, and for the same reason: behind these three components
 * sit CodeMirror, mammoth, pdfjs-dist, jszip and xlsx — several megabytes a
 * consumer would otherwise download on every boot.
 *
 * In this repo's own bundle that cost is almost never repaid. With
 * `dsh-plugins-client-ui-document-host` composed in, the relocated preview
 * engine claims every `dsh-resource://file/**` address — legacy `.doc` and
 * `.ppt` included, which it converts Host-side and which this package has no
 * renderer for at all — so `FilePreview` here is the *fallback* for when no
 * document seat is filled, and the editor and the diff are modes a reader
 * opts into rather than lands on.
 *
 * All three resolve from ONE `import('./bodies.tsx')`, deliberately: see
 * that module for why they cannot be split apart.
 *
 * The bytes only become a separate file where the consuming bundle asks for
 * one, via `clientPluginBundle`'s `codeSplitting`. Without it rolldown keeps
 * the evaluation laziness but packs the chunk back into the entry, which
 * saves nothing on the wire.
 * @module dsh-plugins-client-ui-file-editing/lazy
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { FileEditorProps } from './FileEditor.tsx'
import type { FilePreviewProps } from './FilePreview.tsx'
import type { SideBySideDiffProps } from './SideBySideDiff.tsx'

/** One specifier, so one chunk carries all three — see ./bodies.tsx. */
const load = async () => (await import('./bodies.tsx')).bodies

const LoadedFileEditor = lazy(async () => ({ default: (await load()).FileEditor as ComponentType<FileEditorProps> }))
const LoadedFilePreview = lazy(async () => ({ default: (await load()).FilePreview as ComponentType<FilePreviewProps> }))
const LoadedSideBySideDiff = lazy(async () => ({
  default: (await load()).SideBySideDiff as ComponentType<SideBySideDiffProps>,
}))

/** What to draw while the shared bodies chunk is in flight; the caller owns the copy. */
interface Deferred {
  readonly loading?: ReactNode
}

/**
 * The read-only preview, deferred.
 * @param props - `FilePreview`'s props plus `loading`.
 * @returns the preview once its chunk lands.
 */
export function LazyFilePreview({ loading, ...props }: FilePreviewProps & Deferred): ReactNode {
  return <Suspense fallback={loading ?? null}><LoadedFilePreview {...props} /></Suspense>
}

/**
 * The editor, deferred.
 * @param props - `FileEditor`'s props plus `loading`.
 * @returns the editor once its chunk lands.
 */
export function LazyFileEditor({ loading, ...props }: FileEditorProps & Deferred): ReactNode {
  return <Suspense fallback={loading ?? null}><LoadedFileEditor {...props} /></Suspense>
}

/**
 * The side-by-side diff, deferred.
 * @param props - `SideBySideDiff`'s props plus `loading`.
 * @returns the diff once its chunk lands.
 */
export function LazySideBySideDiff({ loading, ...props }: SideBySideDiffProps & Deferred): ReactNode {
  return <Suspense fallback={loading ?? null}><LoadedSideBySideDiff {...props} /></Suspense>
}
