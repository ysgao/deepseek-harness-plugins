/**
 * This package's renderers, fetched only when a file actually selects one.
 *
 * Same shape as the vendored engine's own `LazyPdfBody`/`LazyExcelBody`.
 * Without it the `mammoth`/`jszip`/`xlsx` extractors behind the Office text
 * views would land in this package's entry bundle — which every boot
 * downloads — to serve viewers the reader has to choose from a menu before
 * they draw anything.
 *
 * Every wrapper resolves from ONE `import('./text-bodies.tsx')`; see that
 * module for why they cannot be split apart.
 * @module dsh-plugins-client-ui-document-host/lazy-bodies
 */
import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { DelimitedPreviewProps } from 'dsh-plugins-client-ui-file-editing/src/DelimitedPreview.tsx'
import type { DocxPreviewProps } from 'dsh-plugins-client-ui-file-editing/src/DocxPreview.tsx'
import type { OntologyPreviewProps } from 'dsh-plugins-client-ui-file-editing/src/OntologyPreview.tsx'
import type { PptxPreviewProps } from 'dsh-plugins-client-ui-file-editing/src/PptxPreview.tsx'
import type { RtfPreviewProps } from 'dsh-plugins-client-ui-file-editing/src/RtfPreview.tsx'
import type { XlsxPreviewProps } from 'dsh-plugins-client-ui-file-editing/src/XlsxPreview.tsx'

const load = async () => (await import('./text-bodies.tsx')).textBodies

/** Wrap one body in the shared chunk behind a Suspense boundary. @param pick - selects the body. @returns the deferred component. */
function deferred<P extends object>(pick: (b: Awaited<ReturnType<typeof load>>) => ComponentType<P>) {
  // Erased to an open prop bag INSIDE the helper, then restored on the way
  // out by `Deferred`'s own signature. React's element types are invariant in
  // their props, so neither a JSX spread nor `createElement` accepts a bare
  // generic `P`; the public type below is what callers are checked against,
  // and it is exact.
  const Loaded = lazy(async () => ({ default: pick(await load()) })) as unknown as ComponentType<Record<string, unknown>>
  return function Deferred(props: P & { loading?: ReactNode }): ReactNode {
    const { loading, ...rest } = props as P & { loading?: ReactNode }
    return <Suspense fallback={loading ?? null}>{createElement(Loaded, rest as Record<string, unknown>)}</Suspense>
  }
}

export const LazyDelimitedPreview = deferred<DelimitedPreviewProps>(b => b.DelimitedPreview)
export const LazyDocxPreview = deferred<DocxPreviewProps>(b => b.DocxPreview)
export const LazyOntologyPreview = deferred<OntologyPreviewProps>(b => b.OntologyPreview)
export const LazyPptxPreview = deferred<PptxPreviewProps>(b => b.PptxPreview)
export const LazyRtfPreview = deferred<RtfPreviewProps>(b => b.RtfPreview)
export const LazyXlsxPreview = deferred<XlsxPreviewProps>(b => b.XlsxPreview)
