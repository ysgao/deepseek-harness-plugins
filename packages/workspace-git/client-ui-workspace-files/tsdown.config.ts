import { cpSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * Plain Node/ESM library build — see ../client-ui-file-editing/tsdown.
 * config.ts's doc comment for the general rationale (mirrored here). Named
 * entries (not a glob) because `./client` must build to a fixed `client.js`
 * basename, distinct from the Host-safe no-op at `.`/`index.js` — a real
 * `dsh --profile ... boot` proved the Host Loader imports every entry's
 * DEFAULT export (even for a Client-face row) before deciding whether to
 * activate it, and `./src/client/index.ts`'s transitive `dsh-client-ui-
 * primitives` CSS Modules imports throw `ERR_UNKNOWN_FILE_EXTENSION` under
 * plain Node ESM — hence the split. This package is still delivered as a
 * static import from the upstream-ready `WorkspaceBrowser`/`dsh-client-ui-
 * workspace` diff (ARCHITECTURE.md Task 19), not a dynamically-loaded
 * `dsh plugin add` bundle, so it needs no browser closure-factory format —
 * only this two-entry-point split, the same shape
 * `yga/deepseek-harness`'s own `ui-conversation-files` package already used.
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
