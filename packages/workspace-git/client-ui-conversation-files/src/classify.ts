/**
 * File-extension classification for the File tab's in-app preview: which
 * `FilePreviewKind` a file opens as, and (for text/code) which shiki
 * grammar hints its highlighting. Duplicated in miniature from this repo's
 * own `dsh-plugins-client-ui-workspace-files/classify.ts` (itself
 * duplicated from the `read` tool's `langFromPath`) rather than imported —
 * cross-package imports of another plugin's symbols are forbidden
 * (`packages/client/AGENTS.md` in the vendored harness), and this is a
 * small pure mapping, not a shared business concept.
 */
import type { FilePreviewKind } from 'dsh-plugins-client-ui-file-editing'

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

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'env', 'gitignore', 'gitattributes', 'editorconfig',
  ...Object.keys(LANG_BY_EXTENSION),
])
/**
 * OWL/RDF ontology extensions, opened as `FilePreviewKind: 'ontology'` rather
 * than as plain text. They *are* plain text; the separate kind exists because
 * their highlighting cannot be resolved from the extension — `.owl` alone is
 * used for RDF/XML, OWL 2 Functional Syntax, Manchester Syntax, and Turtle
 * interchangeably, so the preview detects the serialization from the file's own
 * content instead (see `dsh-plugins-client-ui-file-editing`'s
 * `OntologyPreview`), which is also why none of these carries a
 * `LANG_BY_EXTENSION` entry.
 */
const ONTOLOGY_EXTENSIONS = new Set([
  'owl',
  'rdf', 'rdfs', 'owx',
  'ofn', 'omn',
  'ttl', 'trig', 'n3', 'nt', 'nq',
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
 * classified by `MARKDOWN_EXTENSIONS`/`TEXT_EXTENSIONS` above and never
 * needs this set. Duplicated from this repo's own
 * `dsh-plugins-client-ui-workspace-files/classify.ts` for the same reason as
 * the rest of this file (see the file doc comment).
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
function extensionOf(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Lowercased base name of a path, for matching against `TEXT_FILENAMES`.
 * @param path - absolute or display path.
 * @returns the base name (file name with no directory components), lowercased.
 */
function baseNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase()
}

/**
 * Which `FilePreviewKind` a file path's extension selects. Legacy binary
 * `.doc`/`.ppt` (pre-2007 OLE compound-file format — no client-side parser
 * available for either) and every other unrecognized extension or base
 * name answer `'external'` (the `openPath` OS-default handoff).
 * @param path - absolute or display path.
 * @returns the preview kind to open the file as.
 */
export function viewerKindFor(path: string): FilePreviewKind {
  const ext = extensionOf(path)
  if (ext === undefined) return TEXT_FILENAMES.has(baseNameOf(path)) ? 'text' : 'external'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (ONTOLOGY_EXTENSIONS.has(ext)) return 'ontology'
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
