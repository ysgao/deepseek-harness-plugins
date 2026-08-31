import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`/`invariant`, plain Node ESM — the
 * Host Loader imports every entry's DEFAULT export during composition, even
 * for a Client-face row, so it must stay import-safe) and the real browser
 * bundle (`./client`, closure-factory format via `clientPluginBundle` — see
 * ../../../tsdown.client-plugin-preset.ts's doc comment for why that isn't
 * the vendored `clientConfig()` preset directly). This package's mount
 * point is `dsh-plugins-client-ui-workspace-enhanced` — an out-of-tree
 * replacement for `dsh-client-ui-workspace`'s own `sidebar.workspaces`
 * registration, not an upstream diff to that package (see ARCHITECTURE.md)
 * — so this closure-factory bundle is a real `dsh plugin add` target like
 * every other Client package here, not a build artifact nothing loads yet.
 */
export default defineConfig([
  {
    entry: {
      index: 'lib/types/index.js',
      invariant: 'lib/types/invariant.js',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  clientPluginBundle('dsh-plugins-client-ui-workspace-files', 'lib/types/client/index.js'),
])
