import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`/`invariant`, plain Node ESM) and
 * the real browser bundle (`./client`, closure-factory format via
 * `clientPluginBundle` — see ../../../tsdown.client-plugin-preset.ts's doc
 * comment). See ../client-ui-workspace-enhanced/tsdown.config.ts for the
 * same shape and the fuller "why a two-entry-point split" story.
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
  clientPluginBundle('dsh-plugins-client-ui-conversation-enhanced', 'lib/types/client/index.js', {
    // This package forks dsh-client-ui-conversation's own ConversationSession
    // export and imports the rest of that package's internals (ConversationRoot,
    // ConversationSessionHeader, InputBar, the input hub, the queue/settings
    // docks, stores, locales) unchanged — safe to inline because the original
    // package's own browser plugin row is disabled wherever this one is
    // installed (cordis.patch.yml), so no sibling instance exists to
    // duplicate shared identity against.
    extraInlineSafe: /^@deepseek-ai\/dsh-client-ui-conversation\/src\//,
  }),
])
