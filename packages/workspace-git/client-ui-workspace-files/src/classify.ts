/**
 * File-extension classification for the Workspace Files tree's in-app
 * preview: which viewer a file opens in, and (for text/code) which shiki
 * grammar hints its highlighting. Intentionally small — common source,
 * config, markup, ontology, tabular, document, PDF, and Office extensions
 * worth a dedicated in-app view — not an exhaustive registry; unmatched
 * extensions fall back to `openPath` (the host's OS-default-application
 * handoff).
 */
import type { FilePreviewKind } from 'dsh-plugins-client-ui-file-editing'

/** Which in-app viewer (`FileViewer`, itself a thin wrapper around the shared `FilePreview`) a file extension opens, or none, meaning `openPath`. */
export type FileViewerKind = FilePreviewKind

/**
 * shiki grammar hint by extension, duplicated in miniature from the `read`
 * tool's `langFromPath` (`packages/fs/tool-fs`) rather than imported: that
 * package is host/model-tool code, and importing it here would cross the
 * client/host layering boundary for a small pure mapping.
 */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

/** Image extensions the viewer renders inline through a blob URL. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

/** Markdown extensions rendered through the shared `MarkdownText` component. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

/**
 * Text/code extensions worth a highlighted in-app preview. A deliberately
 * closed allowlist — not "everything that isn't image/markdown/pdf" — so an
 * unrecognized binary format never gets forced through UTF-8 decoding by the
 * viewer; the host's own read already answers `kind: 'binary'` for genuine
 * non-text bytes, but a closed allowlist here keeps the extension-based
 * decision legible without depending on that fact.
 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'env', 'gitignore', 'gitattributes', 'editorconfig',
  // Keys and certificates: PEM/OpenSSH material is plain text, and there is
  // no highlighting to add over a line-numbered monospace view of it, so it
  // wants the plain text body rather than a kind of its own. `pub` is what
  // `extensionOf` answers for the conventional `<name>.key.pub` double
  // extension (it reads the last one), and covers a bare `id_ed25519.pub`
  // alike. A `.key` that is really an Apple Keynote deck (the other, binary
  // meaning of that extension) never renders as text regardless: the Host's
  // own read answers `kind: 'binary'` for it, which `isContentMismatch`
  // turns into the "Open with default app" fallback.
  'key', 'pub',
  ...Object.keys(LANG_BY_EXTENSION),
])

/**
 * Delimiter-separated text, previewed as a table (`FilePreviewKind:
 * 'delimited'`). Plain text like any other — the kind exists only because a
 * table is what a reader wants from a CSV, exactly as `xlsx` is what they want
 * from a spreadsheet. `.tab` is listed with `.tsv` as its long-standing
 * synonym; the delimiter itself is settled per-file (a `.csv` may really be
 * semicolon-separated), see `DelimitedPreview`.
 */
const DELIMITED_EXTENSIONS = new Set(['csv', 'tsv', 'tab'])

/**
 * Rich Text Format, previewed as its extracted text (`FilePreviewKind:
 * 'rtf'`). Unlike `.docx`, RTF is plain-text markup, so it is editable and
 * diffable as text and needs no binary parser — see `RtfPreview`.
 */
const RTF_EXTENSIONS = new Set(['rtf'])

/**
 * OWL/RDF ontology extensions, opened in the dedicated ontology viewer
 * (`FilePreviewKind: 'ontology'`) rather than as plain text. Every one of them
 * *is* plain text — the viewer kind exists because their highlighting cannot
 * be resolved from the extension: `.owl` in particular is used for RDF/XML,
 * OWL 2 Functional Syntax, Manchester Syntax, and Turtle interchangeably, so
 * the viewer detects the serialization from the file's own content instead
 * (see `dsh-plugins-client-ui-file-editing`'s `OntologyPreview`). This is why
 * they carry no {@link LANG_BY_EXTENSION} entry: a `lang` hint keyed off the
 * extension would be a guess, and the wrong guess for a third of these files.
 * The serialization-specific extensions are listed alongside `.owl`/`.rdf`
 * because they are the same content under a name that happens to say which
 * serialization it holds.
 */
const ONTOLOGY_EXTENSIONS = new Set([
  // Extension names no serialization: any of the OWL 2 ones.
  'owl',
  // RDF/XML and OWL/XML.
  'rdf', 'rdfs', 'owx',
  // The OWL 2 text syntaxes.
  'ofn', 'omn',
  // The Turtle family.
  'ttl', 'trig', 'n3', 'nt', 'nq',
  // JSON-LD.
  'jsonld',
])

const PDF_EXTENSIONS = new Set(['pdf'])
/** Open XML Word documents (`mammoth` requires a zip-based `.docx`; legacy binary `.doc` never classifies to this kind). */
const DOCX_EXTENSIONS = new Set(['docx'])
/** `.xlsx` (Open XML) and legacy BIFF8 `.xls` alike — `xlsx`/SheetJS reads both from the same raw bytes. */
const XLSX_EXTENSIONS = new Set(['xlsx', 'xls'])
/** Open XML PowerPoint decks (a text-only extraction; legacy binary `.ppt` never classifies to this kind). */
const PPTX_EXTENSIONS = new Set(['pptx'])

/**
 * Full base-name matches (case-insensitive) for known-text files that carry
 * no extension `extensionOf` can key off of: a dotfile (`.gitignore` — the
 * whole name after its leading dot *is* the marker, so `extensionOf` sees no
 * extension) or a conventional extension-less name (`LICENSE`, `Makefile`).
 * Checked only when `extensionOf` answers `undefined`, so a file that
 * additionally carries a real extension (`LICENSE.md`, `foo.env`) is already
 * classified by {@link MARKDOWN_EXTENSIONS}/{@link TEXT_EXTENSIONS} above and
 * never needs this set.
 */
const TEXT_FILENAMES = new Set([
  // Dotfiles.
  '.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', '.editorconfig',
  '.env', '.dockerignore', '.npmignore', '.npmrc', '.nvmrc', '.yarnrc',
  '.prettierrc', '.eslintrc', '.babelrc', '.browserslistrc', '.stylelintrc',
  // Extension-less conventional names.
  'license', 'licence', 'unlicense', 'copying', 'notice', 'readme',
  'authors', 'contributors', 'changelog', 'changes', 'history', 'news', 'todo',
  'makefile', 'dockerfile', 'procfile', 'gemfile', 'rakefile', 'vagrantfile',
  'jenkinsfile', 'brewfile',
])

/**
 * Lowercased extension of a path's base name, or `undefined` for a dotfile
 * (leading-dot-only name) or a name with no extension.
 * @param path - absolute or display path.
 * @returns the extension without its leading dot, lowercased.
 */
export function extensionOf(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Lowercased base name of a path, for matching against {@link TEXT_FILENAMES}.
 * @param path - absolute or display path.
 * @returns the base name (file name with no directory components), lowercased.
 */
function baseNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase()
}

/**
 * Which in-app viewer a file path's extension selects. Legacy binary
 * `.doc`/`.ppt` (pre-2007 OLE compound-file format — no client-side parser
 * available for either) and every other unrecognized extension or base
 * name answer `'external'` (the `openPath` OS-default handoff).
 * @param path - absolute or display path.
 * @returns the viewer kind to open the file in.
 */
export function viewerKindFor(path: string): FileViewerKind {
  const ext = extensionOf(path)
  if (ext === undefined) return TEXT_FILENAMES.has(baseNameOf(path)) ? 'text' : 'external'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (ONTOLOGY_EXTENSIONS.has(ext)) return 'ontology'
  if (DELIMITED_EXTENSIONS.has(ext)) return 'delimited'
  if (RTF_EXTENSIONS.has(ext)) return 'rtf'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (DOCX_EXTENSIONS.has(ext)) return 'docx'
  if (XLSX_EXTENSIONS.has(ext)) return 'xlsx'
  if (PPTX_EXTENSIONS.has(ext)) return 'pptx'
  return 'external'
}

/**
 * shiki grammar hint for a text/code preview.
 * @param path - absolute or display path.
 * @returns the language hint, or `undefined` when the extension maps to none (plain monospace).
 */
export function langFromPath(path: string): string | undefined {
  const ext = extensionOf(path)
  if (ext === undefined) return undefined
  return Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}
