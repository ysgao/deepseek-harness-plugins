import { defineConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`, plain Node ESM — the Host Loader
 * imports every entry's DEFAULT export during composition, even for a
 * Client-face row, so it must stay import-safe) and the real browser bundle
 * (`./client`, closure-factory format via `clientPluginBundle` — see
 * ../../../tsdown.client-plugin-preset.ts's doc comment for why that isn't
 * the vendored `clientConfig()` preset directly). See
 * ../../workspace-git/client-ui-workspace-enhanced/tsdown.config.ts for the
 * same shape and the fuller "why extraInlineSafe" story.
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
  clientPluginBundle('dsh-plugins-client-ui-settings-anthropic-subscription', 'lib/types/client/index.js', {
    // This package forks dsh-client-ui-settings-models's own ModelsSection.tsx,
    // ProviderEditor.tsx, index.ts, and locales.ts, and imports the rest of
    // that package's internals (CustomProviderCard, DeepSeekModelsEditor,
    // DeepSeekOnboardingDialog, WelcomeNotice, store, schema-operations,
    // slot-contract, onboarding-copy, EditorFooter, ModelListEditor, apiKey,
    // ModelsSection.module.css) unchanged — safe to inline because the
    // original package's own row is disabled wherever this one is installed
    // (cordis.patch.yml), so no sibling instance exists to duplicate shared
    // identity against.
    extraInlineSafe: /^@deepseek-ai\/dsh-client-ui-settings-models\/src\//,
  }),
])
