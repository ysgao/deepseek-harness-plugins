import { cpSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * Plain Node/ESM library build. Named entries (not a glob) because
 * `./client` must build to a fixed `client.js` basename, distinct from the
 * Host-safe no-op at `.`/`index.js` — a real `dsh --profile ... boot` proved
 * the Host Loader imports every entry's DEFAULT export (even for a
 * Client-face row) before deciding whether to activate it, and
 * `./src/client/index.ts`'s transitive `dsh-client-ui-primitives` CSS
 * Modules imports throw `ERR_UNKNOWN_FILE_EXTENSION` under plain Node
 * ESM — hence the split, the same shape `yga/deepseek-harness`'s own
 * `ui-conversation-files` package already used, and the same fix applied to
 * `../client-ui-workspace-files`'s own tsdown.config.ts (see its doc
 * comment for the fuller story). This package mounts into a genuine
 * pristine slot, so — unlike that sibling — it could in principle ship as a
 * real dynamically-loaded `dsh plugin add` bundle; that closure-factory/
 * CSS-modules-inline machinery is still future work (see the repo root
 * tsdown.config.ts's own doc comment), so for now this builds the same
 * plain two-entry-point way.
 */
export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    invariant: 'lib/types/invariant.js',
    client: 'lib/types/client/index.js',
  },
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
