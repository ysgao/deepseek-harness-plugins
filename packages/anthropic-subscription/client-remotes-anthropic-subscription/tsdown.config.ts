import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`, plain Node ESM — the Host Loader
 * imports every entry's DEFAULT export during composition, even for a
 * Client-face row, so it must stay import-safe) and the real browser bundle
 * (`./client`, closure-factory format via `clientPluginBundle` — see
 * ../../../tsdown.client-plugin-preset.ts's doc comment for why that isn't
 * the vendored `clientConfig()` preset directly).
 */
export default defineConfig([
  {
    entry: {
      index: 'lib/types/index.js',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  clientPluginBundle('dsh-plugins-client-remotes-anthropic-subscription', 'lib/types/client/index.js'),
])
