import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`, plain Node ESM) and the real
 * browser bundle (`./client`, closure-factory format via
 * `clientPluginBundle` — see ../../../tsdown.client-plugin-preset.ts's doc
 * comment). See ../client-ui-workspace-enhanced/tsdown.config.ts for the
 * same shape.
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
  clientPluginBundle('dsh-plugins-client-ui-conversation-enhanced', 'lib/types/client/index.js', {
    // This package forks dsh-client-ui-conversation's own ConversationSession
    // export and imports the rest of that package's internals (ConversationRoot,
    // ConversationSessionHeader, InputBar, the input hub, the queue/settings
    // docks, stores, locales) unchanged — safe to inline because the original
    // package's own browser plugin row is disabled wherever this one is
    // installed (cordis.patch.yml), so no sibling instance exists to
    // duplicate shared identity against.
    extraInlineSafe: /^@deepseek-ai\/dsh-client-ui-conversation\/src\//,
    // dsh-client-ui-primitives and dsh-client-ui-slots ARE sibling plugins
    // that stay installed and instantiated (nothing here disables either
    // row) — mirror this package's own package.json dsh.client.external
    // declaration, verbatim.
    clientExternal: [
      '@deepseek-ai/dsh-client-ui-primitives/client',
      '@deepseek-ai/dsh-client-ui-slots/client',
    ],
  }),
])
