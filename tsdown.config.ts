import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/_vendor/deepseek-harness/packages/typert/generator/lib/types/tsdown-plugin.js'

/**
 * Host-only bundle: this repo's plugin bundles have no browser/client half
 * (yet), so unlike deepseek-harness's own root config there is no
 * DSH_BUILD_FACE switch — every package here bundles its tsc-emitted
 * lib/types output and runs Typert generation in one workspace-mode pass,
 * mirroring vendor/deepseek-harness/tsdown.config.ts.
 */
// Narrowed to packages that are actually implemented (have compiled
// lib/types output); widen this list as each stub in ARCHITECTURE.md gets
// ported, rather than including unbuilt stubs tsdown would fail resolving.
export default defineConfig({
  workspace: [
    'packages/anthropic-subscription/api-authorization-controller',
    'packages/anthropic-subscription/cli-login-app',
  ],
  entry: ['lib/types/{index,invariant}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
})
