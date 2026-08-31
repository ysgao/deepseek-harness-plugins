# dsh-plugins-client-ui-file-editing

**Status: Phase 0 scaffold — not yet implemented.**

`FileEditor`, `FilePreview`, `SideBySideDiff`, a CodeMirror theme, and
`useSplitRatio` — the generic file-editing primitives the File manager
feature needs, kept in their own package instead of the shared
`@deepseek-ai/dsh-client-ui-primitives`, which every other UI plugin
depends on.

Ports `packages/client/ui-primitives/src/{FileEditor,FilePreview,
SideBySideDiff}.tsx` (+ `.module.css`, `codemirror/theme.ts`,
`useSplitRatio.ts`, tests) from `yga/deepseek-harness`. Consumed by
`dsh-plugins-client-ui-workspace-files` and
`dsh-plugins-client-ui-conversation-files`.
