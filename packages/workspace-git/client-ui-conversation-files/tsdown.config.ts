import { cpSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * Plain Node/ESM library build — see ../client-ui-file-editing/tsdown.
 * config.ts's doc comment for the full rationale. This package registers
 * into the pristine `conversation.view` slot, so unlike
 * ../client-ui-workspace-files (delivered as a static upstream-PR import),
 * this one COULD ship as a real dynamically-loaded `dsh plugin add` bundle
 * — but that closure-factory/CSS-modules-inline machinery is still future
 * work (see tsdown.config.ts's own doc comment at the repo root); for now
 * this builds the same plain way its siblings do.
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
