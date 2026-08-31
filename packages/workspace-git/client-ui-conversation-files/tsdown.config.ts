import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`/`invariant`, plain Node ESM — the
 * Host Loader imports every entry's DEFAULT export during composition, even
 * for a Client-face row, so it must stay import-safe) and the real browser
 * bundle (`./client`, closure-factory format via `clientPluginBundle` — see
 * ../../../tsdown.client-plugin-preset.ts's doc comment for why that isn't
 * the vendored `clientConfig()` preset directly). This package mounts into
 * `dsh-client-ui-conversation`'s pristine `conversation.view` slot, so
 * — unlike `../client-ui-workspace-files` — it needs no upstream diff at
 * all: this closure-factory bundle is what makes it a genuine
 * dynamically-loadable `dsh plugin add` target, not just a Host-safe
 * composition no-op.
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
  clientPluginBundle('dsh-plugins-client-ui-conversation-files', 'lib/types/client/index.js'),
])
