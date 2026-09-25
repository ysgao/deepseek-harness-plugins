/**
 * The three file bodies, behind one module — and therefore behind one
 * dynamic import.
 *
 * This exists only so that `./lazy.tsx` has a single specifier to import.
 * Splitting the bodies across separate dynamic imports would give each its
 * own chunk, and those chunks share a great deal (`OntologyPreview`,
 * `RtfPreview`, `DelimitedPreview`, `clsx`) — which rolldown would hoist
 * into a further shared chunk that each chunk then requires
 * SYNCHRONOUSLY. The closure-factory loader cannot answer a synchronous
 * cross-chunk require, so every body that shares anything with another has
 * to travel in the same chunk as the things it shares.
 *
 * Nothing should import this module statically. `./lazy.tsx` is the entry
 * point; importing from here directly puts the whole graph — CodeMirror,
 * mammoth, pdfjs-dist, jszip, xlsx — back into the caller's own bundle.
 * @module dsh-plugins-client-ui-file-editing/bodies
 */

import { FileEditor } from './FileEditor.tsx'
import { FilePreview } from './FilePreview.tsx'
import { SideBySideDiff } from './SideBySideDiff.tsx'

/**
 * The bodies, as one value.
 *
 * A value export rather than three `export … from` re-exports: rolldown
 * emits a bare side-effect `require` of a re-export-only chunk at the top of
 * the importing entry, which is precisely the synchronous cross-chunk
 * require this split exists to avoid.
 */
export const bodies = { FileEditor, FilePreview, SideBySideDiff }
