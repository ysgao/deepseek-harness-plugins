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
]

/**
 * Mirrors packages/_vendor/deepseek-harness/tsdown.config.ts's own two-pass
 * host/client split. Unlike that root config, this one scopes `workspace`
 * itself per face rather than relying on every package's shared `entry`
 * resolving to an empty/skip value during the other pass — tsdown's
 * workspace mode does not tolerate an all-empty batch the way a single
 * per-package `entry: ''` does. Both faces bundle their tsc-emitted
 * lib/types output the same plain way; only the host pass also runs Typert
 * generation. Client packages with no Cordis registration of their own
 * (pure component libraries, inlined wherever they're imported rather than
 * independently loaded) don't need the vendored clientBundle()'s
 * closure-factory/CSS-modules-inline machinery — that helper's
 * workspaceManifest() lookup is hardcoded to
 * packages/_vendor/deepseek-harness's own root besides, so it cannot see
 * this repo's packages at all. dsh-plugins-client-ui-workspace-files turned
 * out not to need that machinery either, despite registering a real Context
 * service (`workspaceFilesNode`): it is delivered as a static import from
 * dsh-client-ui-workspace's own upstream-ready diff (ARCHITECTURE.md Task
 * 19), the same delivery mechanism the Settings UI panel already documents,
 * not as a dynamically-loaded out-of-tree bundle — so a package only needs
 * the closure-factory format when it is genuinely meant to install through
 * `dsh plugin add` at runtime rather than through a small upstream PR.
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
