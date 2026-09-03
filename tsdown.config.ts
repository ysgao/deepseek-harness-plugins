import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/_vendor/deepseek-harness/packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value) {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

const HOST_PACKAGES = [
  'packages/anthropic-subscription/api-authorization-controller',
  'packages/anthropic-subscription/cli-login-app',
  'packages/workspace-git/api-workspace-git-controller',
  'packages/workspace-git/api-workspace-file-controller',
]

const CLIENT_PACKAGES = [
  'packages/workspace-git/client-ui-file-editing',
  'packages/workspace-git/client-ui-workspace-files',
  'packages/workspace-git/client-ui-conversation-files',
  'packages/workspace-git/client-ui-workspace-enhanced',
  'packages/workspace-git/client-ui-conversation-enhanced',
  'packages/workspace-git/client-remotes-workspace-git',
  'packages/anthropic-subscription/client-remotes-anthropic-subscription',
  'packages/anthropic-subscription/client-ui-settings-anthropic-subscription',
]

/**
 * Mirrors packages/_vendor/deepseek-harness/tsdown.config.ts's own two-pass
 * host/client split. Unlike that root config, this one scopes `workspace`
 * itself per face rather than relying on every package's shared `entry`
 * resolving to an empty/skip value during the other pass — tsdown's
 * workspace mode does not tolerate an all-empty batch the way a single
 * per-package `entry: ''` does. Both faces bundle their tsc-emitted
 * lib/types output the same plain way; only the host pass also runs Typert
 * generation. `dsh-plugins-client-ui-file-editing` is the one exception with
 * no per-package tsdown.config.ts of its own needing the closure-factory
 * preset: a pure component library with no Cordis registration, inlined
 * wherever it's imported rather than independently loaded. Every other
 * Client package here has its own tsdown.config.ts building a real
 * `window.__ModuleLoader__.load(...)` browser bundle via
 * ../tsdown.client-plugin-preset.ts (see that file's own doc comment for why
 * it isn't the vendored clientBundle()/clientConfig() preset directly).
 * Narrowed to packages that are actually implemented; widen as each stub in
 * ARCHITECTURE.md gets ported, rather than including unbuilt stubs tsdown
 * would fail resolving.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: client ? CLIENT_PACKAGES : HOST_PACKAGES,
    entry: ['lib/types/{index,invariant}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
