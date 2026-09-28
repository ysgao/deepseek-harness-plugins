/**
 * Per-language CodeMirror 6 grammar for the `FileEditor` buffer, keyed by the
 * same shiki `lang` hint `FileEditor` already receives for its preview pane
 * (`FilePreviewProps.lang` — see `dsh-plugins-client-ui-conversation-
 * files`/`dsh-plugins-client-ui-workspace-files`'s own `classify.ts`, whose
 * `LANG_BY_EXTENSION` vocabulary this module mirrors one-for-one). Adding a
 * language extension does three things beyond the highlighting the preview
 * pane already provides: bracket/tag matching, smart indent, and — the
 * reason this module exists — a per-language `autocomplete` language-data
 * source (`FileEditor.tsx` wires this alongside `wordCompletionSource`, which
 * applies unconditionally, plain-text files included).
 *
 * Every entry here is one of two kinds:
 * - An official `@codemirror/lang-*` package with a real Lezer grammar
 *   (`javascript`, `json`, `html`, `css`, `python`, `rust`, `xml`, `sql`,
 *   `php`) — these also contribute richer completions than keywords alone:
 *   `lang-javascript`/`lang-python` add local-scope-aware completion of
 *   identifiers already declared in the buffer, `lang-html`/`lang-css` add
 *   tag/attribute/property completion.
 * - A `@codemirror/legacy-modes` `StreamParser`, wrapped through
 *   `StreamLanguage.define` — the CodeMirror project's own maintained port of
 *   every CodeMirror 5 mode, covering everything `LANG_BY_EXTENSION` names
 *   that has no dedicated Lezer grammar (`go`, `rb`→ruby, `java`/`c`/`cpp`/
 *   `cs`/`kotlin`→clike, `swift`, `sh`, `yaml`, `toml`, `ini`→properties,
 *   `lua`). These are token-classification parsers, not real grammars, so
 *   their completion contribution is keywords only — still strictly more
 *   than the plain-monospace buffer had before.
 *
 * `tsx`/`jsx` both resolve through `javascript({ jsx: true, typescript })`
 * rather than a `.tsx`/`.jsx`-specific package — there is no such package;
 * upstream's own `lang-javascript` parses both dialects through one grammar,
 * gated by config flags.
 * @module dsh-plugins-client-ui-file-editing/codemirror/languages
 */

import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { c, cpp, csharp, java, kotlin } from '@codemirror/legacy-modes/mode/clike'
import { go } from '@codemirror/legacy-modes/mode/go'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'

/**
 * One `LANG_BY_EXTENSION` value (`classify.ts`'s vocabulary) resolved to its
 * CodeMirror 6 extension, memoized: every `StreamLanguage.define`/`clike`
 * call constructs a parser table once, not per keystroke or per remount.
 * @param lang - the shiki `lang` hint (undefined for an unrecognized
 * extension, in which case this function is not called — see `FileEditor`).
 * @returns the language's CodeMirror extension, or `undefined` when `lang`
 * names something this module has no grammar for (kept in sync with
 * `LANG_BY_EXTENSION`, but not required to be exhaustive — an unmapped
 * `lang` simply keeps today's plain-monospace behavior for that extension).
 */
export function languageExtensionFor(lang: string | undefined): Extension | undefined {
  switch (lang) {
    case 'ts':
    case 'tsx':
      return javascript({ jsx: lang === 'tsx', typescript: true })
    case 'js':
    case 'jsx':
      return javascript({ jsx: lang === 'jsx' })
    case 'json':
      return json()
    case 'html':
      return html()
    case 'css':
    case 'scss':
    case 'less':
      // `@codemirror/lang-css` parses plain CSS syntax; SCSS/Less nest
      // constructs (`&`, `@mixin`, `@include`) its grammar does not model,
      // so a SCSS/Less file gets the same completions/matching a CSS file
      // does (property names, brace matching) rather than none at all —
      // strictly additive over today's no-grammar buffer either way.
      return css()
    case 'py':
      return python()
    case 'rs':
      return rust()
    case 'xml':
      return xml()
    case 'sql':
      return sql()
    case 'php':
      return php()
    case 'go':
      return StreamLanguage.define(go).extension
    case 'rb':
      return StreamLanguage.define(ruby).extension
    case 'java':
      return StreamLanguage.define(java).extension
    case 'c':
      return StreamLanguage.define(c).extension
    case 'cpp':
      return StreamLanguage.define(cpp).extension
    case 'cs':
      return StreamLanguage.define(csharp).extension
    case 'kotlin':
      return StreamLanguage.define(kotlin).extension
    case 'swift':
      return StreamLanguage.define(swift).extension
    case 'sh':
      return StreamLanguage.define(shell).extension
    case 'yaml':
      return StreamLanguage.define(yaml).extension
    case 'toml':
      return StreamLanguage.define(toml).extension
    case 'ini':
      return StreamLanguage.define(properties).extension
    case 'lua':
      return StreamLanguage.define(lua).extension
    default:
      // Unmapped `lang` (e.g. absent), and every non-language kind's own
      // `lang` is always `undefined` (see `FilePreviewProps.lang`'s own
      // contract) — no grammar to attach, same as today.
      return undefined
  }
}
