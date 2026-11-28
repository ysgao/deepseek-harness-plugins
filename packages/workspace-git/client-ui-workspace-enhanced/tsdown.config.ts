import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`, plain Node ESM) and the real
 * browser bundle (`./client`, closure-factory format via
 * `clientPluginBundle` — see ../../../tsdown.client-plugin-preset.ts's doc
 * comment). See ../client-ui-workspace-files/tsdown.config.ts and
 * ../client-ui-conversation-files/tsdown.config.ts for the same shape.
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
  clientPluginBundle('dsh-plugins-client-ui-workspace-enhanced', 'lib/types/client/index.js', {
    // This package forks dsh-client-ui-workspace's own WorkspaceBrowser.tsx
    // and imports the rest of that package's internals (stores, tree,
    // navigation, locales, WorkspacePicker, Rows) unchanged — safe to
    // inline because the original package's own browser plugin row is
    // disabled wherever this one is installed (cordis.patch.yml), so no
    // sibling instance exists to duplicate shared identity against.
    extraInlineSafe: /^@deepseek-ai\/dsh-client-ui-workspace\/src\//,
    // dsh-client-ui-primitives IS a sibling plugin that stays installed and
    // instantiated (nothing here disables its row), so unlike the
    // extraInlineSafe case above, its own icon components genuinely must
    // not be inlined — mirror this package's own package.json
    // dsh.client.external declaration, verbatim, so the purity gate and the
    // real client module loader agree on what this bundle resolves at
    // runtime instead of bundling privately.
    clientExternal: ['@deepseek-ai/dsh-client-ui-primitives/client'],
  }),
])
