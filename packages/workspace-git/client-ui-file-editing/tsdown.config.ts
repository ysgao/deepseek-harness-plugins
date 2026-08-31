import { cpSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * Plain Node/ESM library build (no browser closure-factory bundle — see
 * ../../../tsdown.config.ts's doc comment for why). CSS Modules imports stay
 * external, unresolved relative imports in the output: this package is never
 * run standalone, only inlined into a consumer's own browser bundle, whose
 * `dsh-css-modules-inline` rolldown plugin (from the vendored
 * clientBundle()) does the real transform when it traces the import chain
 * into this package — mirroring the "stylesheets ship with the package"
 * contract packages/client/tsdown.client.ts's staticLinkedConfig documents
 * for the same reason. The stylesheets themselves are copied into lib/ at
 * their src-relative path so that relative import resolves on disk.
 */
export default defineConfig({
  entry: ['lib/types/{index,invariant}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: /\.css$/ },
  hooks: {
    'build:done': () => {
      cpSync(
        new URL('src', import.meta.url),
        new URL('lib', import.meta.url),
        { recursive: true, filter: source => source.endsWith('.css') || !source.includes('.') },
      )
    },
  },
})
