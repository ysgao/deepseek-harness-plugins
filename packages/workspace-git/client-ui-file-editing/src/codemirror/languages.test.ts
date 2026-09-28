import { describe, expect, it } from 'vitest'
import { languageExtensionFor } from './languages.ts'

/** Every `lang` value `classify.ts`'s `LANG_BY_EXTENSION` can produce (see that module's own vocabulary), grouped by which family of CodeMirror package should answer it. */
const LEZER_BACKED_LANGS = ['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'scss', 'less', 'py', 'rs', 'xml', 'sql', 'php']
const LEGACY_MODE_LANGS = ['go', 'rb', 'java', 'c', 'cpp', 'cs', 'kotlin', 'swift', 'sh', 'yaml', 'toml', 'ini', 'lua']

describe('languageExtensionFor', () => {
  it.each(LEZER_BACKED_LANGS)('resolves an extension for %s (official grammar)', (lang) => {
    expect(languageExtensionFor(lang)).toBeDefined()
  })

  it.each(LEGACY_MODE_LANGS)('resolves an extension for %s (legacy-modes grammar)', (lang) => {
    expect(languageExtensionFor(lang)).toBeDefined()
  })

  it('returns undefined for an unresolved lang, matching the plain-monospace fallback', () => {
    expect(languageExtensionFor('some-unrecognized-lang')).toBeUndefined()
  })

  it('returns undefined for the absent lang every non-text kind always carries', () => {
    expect(languageExtensionFor(undefined)).toBeUndefined()
  })
})
