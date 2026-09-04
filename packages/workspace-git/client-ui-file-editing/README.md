# dsh-plugins-client-ui-file-editing

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

`FilePreview` additionally renders, read-only:

- PDF — the browser's own built-in viewer, over a caller-supplied blob URL
  (no bundled PDF renderer).
- `.docx` — via `mammoth` (Open XML → HTML, sanitized through `DOMPurify`
  before rendering).
- `.xlsx` and legacy `.xls` — via `xlsx` (SheetJS), as a plain HTML table
  (tabbed when the workbook has more than one sheet).
- `.pptx` — via `jszip`, a text-only extraction of each slide's shapes in
  true presentation order (no layout/fonts/images).

Legacy binary `.doc`/`.ppt` (pre-2007 OLE compound-file format) have no
practical client-side parser and stay in the `external` ("open with default
app") fallback, same as any other unrecognized extension.
