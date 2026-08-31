import { cpSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * Plain Node/ESM library build — see ../client-ui-file-editing/tsdown.
 * config.ts's doc comment for the full rationale (mirrored here verbatim):
 * this package is delivered as a static import from the upstream-ready
 * `WorkspaceBrowser`/`dsh-client-ui-workspace` diff (ARCHITECTURE.md Task
 * 19), the same delivery mechanism already documented for the Settings UI
 * panel, not as a dynamically-loaded out-of-tree bundle — so it needs no
 * browser closure-factory format of its own.
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
