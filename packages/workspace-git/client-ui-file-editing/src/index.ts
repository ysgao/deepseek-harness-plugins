/**
 * File-editing primitives: FileEditor, FilePreview and its per-format bodies
 * (OntologyPreview, DelimitedPreview, RtfPreview, and the Office/PDF ones),
 * and SideBySideDiff. Pure
 * React components with no Cordis registration, kept out of the shared
 * `@deepseek-ai/dsh-client-ui-primitives` package (which every other UI
 * plugin depends on) so this feature's own components don't widen that
 * shared surface. See ../../../ARCHITECTURE.md.
 *
 * @module dsh-plugins-client-ui-file-editing
 */
export { FileEditor } from './FileEditor.tsx'
export type { FileEditorProps, FileEditorResizeLabels } from './FileEditor.tsx'
export { FilePreview } from './FilePreview.tsx'
// From ./kinds.ts, the module that holds no renderer — see its doc comment.
// Importing these two through this barrel still costs a consumer the whole
// preview graph, because the barrel re-exports `FilePreview` above; a
// consumer that wants only the classification should deep-import
// `./src/kinds.ts` instead.
export { isContentMismatch, isTextKind } from './kinds.ts'
export { LazyFilePreview } from './LazyFilePreview.tsx'
export type { LazyFilePreviewProps } from './LazyFilePreview.tsx'
export type {
  DelimitedLabels, FilePreviewKind, FilePreviewLabels, FilePreviewProps, FilePreviewState, FileTextKind, RtfLabels,
} from './FilePreview.tsx'
export { DelimitedPreview } from './DelimitedPreview.tsx'
export type { DelimitedPreviewProps } from './DelimitedPreview.tsx'
export { detectDelimiter, parseDelimited } from './delimited/parse.ts'
export type { Delimiter, DelimitedBounds, DelimitedTable } from './delimited/parse.ts'
export { RtfPreview } from './RtfPreview.tsx'
export type { RtfPreviewProps } from './RtfPreview.tsx'
export { extractRtfText } from './rtf/extract.ts'
export { OntologyPreview } from './OntologyPreview.tsx'
export type { OntologyPreviewProps } from './OntologyPreview.tsx'
export { detectOntologySyntax } from './ontology/syntax.ts'
export type { OntologyDialect, OntologySyntax, OntologySyntaxProfile } from './ontology/syntax.ts'
export { tokenizeOntologyLine } from './ontology/tokenize.ts'
export type { OntologyToken, OntologyTokenKind } from './ontology/tokenize.ts'
export { SideBySideDiff } from './SideBySideDiff.tsx'
export type { SideBySideDiffLabels, SideBySideDiffProps } from './SideBySideDiff.tsx'
export { useSplitRatio } from './useSplitRatio.ts'
export type { SplitDividerProps, SplitRatioOptions, SplitRatioResult } from './useSplitRatio.ts'
export { editorTheme } from './codemirror/theme.ts'
