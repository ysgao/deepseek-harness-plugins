/**
 * Every renderer this package contributes, behind one module — and therefore
 * behind one dynamic import.
 *
 * Deep imports, never `dsh-plugins-client-ui-file-editing`'s barrel: that
 * re-exports `FilePreview`, whose graph pulls the whole preview surface at
 * once. Here each body is taken on its own, and the heavy ones
 * (`mammoth`, `jszip`, `xlsx`) are wanted only in this chunk.
 *
 * All six travel together deliberately. They share `clsx` and each other's
 * helpers, and a module used by two chunks is hoisted by rolldown into a
 * third that the importer then requires SYNCHRONOUSLY — which the
 * closure-factory loader cannot answer. One chunk, one require.async.
 *
 * Nothing should import this module statically; `./lazy-bodies.tsx` is the
 * entry point.
 * @module dsh-plugins-client-ui-document-host/text-bodies
 */
import { DelimitedPreview } from 'dsh-plugins-client-ui-file-editing/src/DelimitedPreview.tsx'
import { DocxPreview } from 'dsh-plugins-client-ui-file-editing/src/DocxPreview.tsx'
import { OntologyPreview } from 'dsh-plugins-client-ui-file-editing/src/OntologyPreview.tsx'
import { PptxPreview } from 'dsh-plugins-client-ui-file-editing/src/PptxPreview.tsx'
import { RtfPreview } from 'dsh-plugins-client-ui-file-editing/src/RtfPreview.tsx'
import { XlsxPreview } from 'dsh-plugins-client-ui-file-editing/src/XlsxPreview.tsx'

/** The bodies, as one value — a value export rather than re-exports, so the importing chunk gets no bare side-effect require. */
export const textBodies = { DelimitedPreview, DocxPreview, OntologyPreview, PptxPreview, RtfPreview, XlsxPreview }
