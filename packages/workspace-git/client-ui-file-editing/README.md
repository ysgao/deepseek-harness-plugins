# dsh-plugins-client-ui-file-editing

`FileEditor`, `FilePreview` (with its per-format bodies — `OntologyPreview`,
`DelimitedPreview`, `RtfPreview`, and the PDF/Office ones), `SideBySideDiff`,
a CodeMirror theme, and `useSplitRatio` — the generic file-editing primitives
the File manager feature needs, kept in their own package instead of the
shared `@deepseek-ai/dsh-client-ui-primitives`, which every other UI plugin
depends on.

Every *text* kind (`isTextKind`: `text`, `markdown`, `ontology`, `delimited`,
`rtf`) is edited and diffed identically — one CodeMirror buffer over the
file's raw text, and `SideBySideDiff`'s two-column text diff — whatever its
read-only preview body makes of that text. In Edit mode that body renders
live in the pane beside the buffer.

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

## Tabular files (`.csv`, `.tsv`, `.tab`)

`FilePreviewKind: 'delimited'` — previewed as a table (`DelimitedPreview`),
because that is what a reader wants from a CSV, exactly as `.xlsx` is
previewed as one. Cell borders, scroll container, and truncation notice match
`XlsxPreview`, so the same data reads alike whichever format it arrived in.

- Quoting is RFC 4180 (`src/delimited/parse.ts`): a quoted field may contain
  the delimiter, doubled quotes, and line breaks — which is exactly why a CSV
  cannot be previewed by splitting on newlines.
- The delimiter is per file, not per extension: `.tsv`/`.tab` is settled by
  name, while a `.csv` is counted off its own content (outside quotes), since
  Excel writes semicolon-separated files under that extension in comma-decimal
  locales. Tab and `|` are recognized too.
- The first row renders as the header. RFC 4180 makes the header line
  optional, so this is an assumption — but it is purely presentational; no
  cell value is altered, hidden, or reordered.
- Bounded at 500 rows × 100 columns with a notice stating the file's true
  size; the parse itself stops materializing rows past that bound.

## Key and certificate files (`.key`, `.key.pub`, `.pub`)

Plain `text` kind: PEM/OpenSSH material is text, and there is no highlighting
to add over a line-numbered monospace view, so it needs no kind of its own.
`.key.pub` is matched by its last extension (`pub`), which also covers a bare
`id_ed25519.pub`. A `.key` that is really an Apple Keynote deck — the other
meaning of that extension — is not forced through UTF-8: the Host's own read
answers `binary` for it, which `isContentMismatch` turns into the "Open with
default app" fallback.

## RTF documents (`.rtf`)

`FilePreviewKind: 'rtf'` — previewed as the document's extracted text
(`RtfPreview`), one element per paragraph, the same posture `PptxPreview`
takes for a deck. RTF is plain-text markup, so unlike `.docx` there is nothing
to unzip and no binary parser to depend on, and the file stays editable and
diffable as text.

`src/rtf/extract.ts` handles what would otherwise produce visibly *wrong*
text rather than merely unformatted text: group nesting, destination groups
that hold no document text (font/color tables, stylesheet, metadata, embedded
picture and object data, and any `\*`-flagged group), `\uN` Unicode with the
`\ucN` fallback-length rule (ignoring it doubles every non-ASCII character),
`\'hh` hex escapes through Windows-1252, and the break/whitespace/punctuation
control words. Formatting (bold, italic, size, color, alignment, images) is
deliberately out of scope for a preview — recovering it would mean
implementing a real RTF reader, and the raw markup is one click away in Edit
mode.
