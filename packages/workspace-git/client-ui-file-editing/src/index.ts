/**
 * File-editing primitives: FileEditor, FilePreview, and SideBySideDiff. Pure
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
export type { FilePreviewKind, FilePreviewLabels, FilePreviewProps, FilePreviewState } from './FilePreview.tsx'
export { SideBySideDiff } from './SideBySideDiff.tsx'
export type { SideBySideDiffLabels, SideBySideDiffProps } from './SideBySideDiff.tsx'
export { useSplitRatio } from './useSplitRatio.ts'
export type { SplitDividerProps, SplitRatioOptions, SplitRatioResult } from './useSplitRatio.ts'
export { editorTheme } from './codemirror/theme.ts'
