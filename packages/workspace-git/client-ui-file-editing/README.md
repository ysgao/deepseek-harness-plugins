# dsh-plugins-client-ui-file-editing

`FileEditor`, `FilePreview`, `OntologyPreview`, `SideBySideDiff`, a
CodeMirror theme, and `useSplitRatio` — the generic file-editing primitives
the File manager feature needs, kept in their own package instead of the
shared `@deepseek-ai/dsh-client-ui-primitives`, which every other UI plugin
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

## Ontology files (`.owl`, `.rdf`, …)

OWL/RDF ontologies are plain text, so Edit and Diff treat them exactly as
any other text file — the same CodeMirror buffer, the same `SideBySideDiff`.
What they need is highlighting, and the *extension does not say which
syntax a file holds*: `.owl` is used for RDF/XML, OWL 2 Functional Syntax,
Manchester Syntax, and Turtle interchangeably. Hence a distinct
`FilePreviewKind: 'ontology'` whose `OntologyPreview` detects the
serialization from the file's own content (`src/ontology/syntax.ts`) and
then either:

- delegates to `ReadBlock` with shiki's own `xml` / `json` grammar —
  RDF/XML, OWL/XML, JSON-LD (the app's one syntax highlighter already
  covers these properly, lazy grammar loading and all); or
- highlights through this package's own line tokenizer
  (`src/ontology/tokenize.ts`) — OWL 2 Functional Syntax, Manchester
  Syntax, and the Turtle family (Turtle, TriG, N3, N-Triples, N-Quads),
  none of which shiki publishes a grammar for.

Both arms render an identical line-numbered body (see
`OntologyPreview.module.css`, a deliberate clone of `ReadBlock`'s own
appearance), and token colors resolve through the same `--shiki-token-*`
theme custom properties every other highlighted surface uses, so light/dark
follow the app. Only the rows on screen are tokenized, which matters
because a large ontology is the normal case rather than the exception.

Known limitation: the tokenizer is per-line and stateless, so a Turtle
multi-line long literal (`"""…"""` spanning lines) is not carried across
its lines as one string run.
