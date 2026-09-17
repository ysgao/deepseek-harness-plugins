import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`, plain Node ESM — the Host Loader
 * imports every entry's DEFAULT export during composition, even for a
 * Client-face row, so it must stay import-safe) and the real browser bundle
 * (`./client`, closure-factory format via `clientPluginBundle` — see
 * ../../../tsdown.client-plugin-preset.ts's doc comment for why that isn't
 * the vendored `clientConfig()` preset directly).
 *
 * No `extraInlineSafe` here, unlike the Models sign-in panel's: this package
 * forks nothing and imports no other plugin's `./src/*` internals, so the
 * purity gate's default allowlist is exactly right. Its one vendor component
 * dependency, `@deepseek-ai/dsh-client-ui-primitives`, is a shared atom
 * library the gate already treats as inline-safe.
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
  clientPluginBundle('dsh-plugins-client-ui-settings-mcp-connector', 'lib/types/client/index.js'),
])
