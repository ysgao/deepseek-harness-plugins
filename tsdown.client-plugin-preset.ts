import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath, sep } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { INLINE_SAFE, requestedExternals } from './packages/_vendor/deepseek-harness/packages/client/tsdown.client.ts'
import { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } from './packages/_vendor/deepseek-harness/packages/client/web/src/platform.ts'

/**
 * Produces a browser closure-factory bundle (`window.__ModuleLoader__.load(
 * {id, factory})`) for one out-of-tree Client plugin package, reproducing
 * the wire contract `packages/_vendor/deepseek-harness/packages/client/
 * tsdown.client.ts`'s own `clientConfig()` produces for in-tree packages.
 *
 * `clientConfig()` itself isn't reusable here: it locates a package's own
 * `dsh.client.external` declaration and production dependencies by globbing
 * `packages/*​/*​/package.json` under the vendored submodule's own hardcoded
 * root (`workspaceManifest()`) — a package outside that tree, like every
 * package in this repo, is invisible to it, and that lookup isn't
 * parameterized or its cache exported for a caller to pre-seed. Rather than
 * touch the vendored submodule to make it configurable (this repo's whole
 * premise is not touching it), this preset takes the same inputs as
 * explicit parameters instead — the caller already has its own
 * `package.json` on disk, so nothing here needs to glob for it.
 *
 * What genuinely reuses the vendored implementation, because it's real,
 * intentionally exported surface, not internals: {@link requestedExternals}
 * (a pure function, no filesystem access) and `INLINE_SAFE`/
 * `PLATFORM_MODULES`/`PRELOADED_CLIENT_EXTERNALS` (plain exported constants,
 * via `dsh-client-web`'s own declared `./src/*` export). Everything else
 * below — the CSS Modules inline plugin, the purity gate, the closure-factory
 * banner/footer, the tsc sourcemap chain — is a deliberate, documented port
 * of `clientConfig()`'s own logic, kept import-for-import equivalent so it
 * can be dropped once/if `workspaceManifest()` genuinely becomes
 * parameterizable upstream (see ARCHITECTURE.md).
 * @module tsdown.client-plugin-preset
 */

const CSS_VIRTUAL_PREFIX = '\0dsh-plugin-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Same closed allowlist `clientConfig()` uses for a rescoped vendored library with no shared runtime identity. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Same closed allowlist `clientConfig()` uses for a generated /remote wire contribution. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** Path segment separating tsc's `lib/types` output from the `src` it was emitted from. */
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

/** Trailing sourcemap reference tsc appends to every emitted module. */
const SOURCEMAP_COMMENT = /\n\/\/# sourceMappingURL=.*\s*$/

/** Emit one plugin-owned style injector and an optional CSS Modules class-name export. */
function styleInjectionModule(id: string, fileId: string, css: string, classMap?: Readonly<Record<string, string>>): string {
  // Keyed on the resolved source path, not just its basename: two packages
  // (a fork and the vendor package it forks) routinely each own a
  // same-named CSS Module (e.g. both `dsh-plugins-client-ui-conversation-
  // enhanced`'s and `dsh-client-ui-conversation`'s own
  // `ConversationRoot.module.css`) that land in the very same bundle
  // whenever the fork's fallback path pulls in the vendor's own component
  // tree — a basename-only tag id collided between them, so the second
  // injection's `document.querySelector(...) === null` guard saw a tag
  // already present and silently skipped inserting its own stylesheet,
  // leaving the DOM's fork-scoped classnames with no matching rules at all
  // (see ARCHITECTURE.md's "Replaced-plugin resilience").
  const basename = fileId.split(sep).pop()
  const hash = createHash('sha1').update(fileId).digest('hex').slice(0, 8)
  const tagId = `${id}/${hash}-${basename}`
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

const requireFromPreset = createRequire(import.meta.url)

/**
 * Resolve an emitted JS asset import back to its source-tree counterpart
 * under `src/`. A bare package specifier (a package forking another's
 * `./src/*` export, e.g. `@deepseek-ai/dsh-client-ui-settings-models/src/
 * client/ModelsSection.module.css`) is not a path fragment relative to the
 * importer's directory — it is resolved through real Node module resolution
 * (honoring the target package's own `exports` map) instead, rooted at the
 * importer's directory so it walks up to that package's own `node_modules`.
 */
function sourceAssetPath(source: string, importer: string): string {
  if (!source.startsWith('.') && !source.startsWith('/')) {
    return requireFromPreset.resolve(source, { paths: [dirname(importer)] })
  }
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

/** Chain tsc's emitted sourcemaps into the browser bundle for real stack traces over TS/TSX. */
function tscSourceMapPlugin() {
  return {
    name: 'dsh-plugin-tsc-sourcemap',
    async load(id: string) {
      if (!id.includes(TYPES_MARKER) || !id.endsWith('.js') || !existsSync(`${id}.map`)) return null
      const code = await readFileAsync(id, 'utf8')
      const mapPath = `${id}.map`
      const map = JSON.parse(await readFileAsync(mapPath, 'utf8')) as {
        sourceRoot?: unknown
        sources?: unknown
        sourcesContent?: unknown
        [key: string]: unknown
      }
      if (!Array.isArray(map.sources) || map.sources.some(source => typeof source !== 'string')) {
        throw new Error(`client plugin sourcemap: ${mapPath} has invalid sources`)
      }
      const sources = map.sources as string[]
      if (
        !Array.isArray(map.sourcesContent)
        || map.sourcesContent.length !== sources.length
        || map.sourcesContent.some(source => typeof source !== 'string')
      ) {
        const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : ''
        map.sourcesContent = await Promise.all(
          sources.map(async source => await readFileAsync(resolvePath(dirname(mapPath), sourceRoot, source), 'utf8')),
        )
      }
      return { code: code.replace(SOURCEMAP_COMMENT, ''), map }
    },
  }
}

/** Options a caller passes instead of what `workspaceManifest()` would have read from an in-tree package.json. */
export interface ClientPluginBundleOptions {
  /** This package's own `dsh.client.external` array, verbatim from its package.json (absent when it declares none). */
  clientExternal?: readonly string[]
  /**
   * Extra `@deepseek-ai/*` import patterns the purity gate treats as safe to
   * inline, beyond the shared `INLINE_SAFE` set — for a package that
   * deliberately forks another package's own internals wholesale (see
   * `dsh-plugins-client-ui-workspace-enhanced`'s own `./src/client/*`
   * imports from `@deepseek-ai/dsh-client-ui-workspace/src/client/*`: since
   * that package's own browser plugin row is disabled wherever this one is
   * installed, there is no live sibling instance to duplicate identity
   * against, so inlining is genuinely safe here, unlike the general case
   * the gate otherwise protects against).
   */
  extraInlineSafe?: RegExp
}

/**
 * Build the browser closure-factory bundle config for one out-of-tree
 * Client plugin package.
 * @param id - plugin id (package name), stamped into the `__ModuleLoader__.load` handoff and the injected style tags.
 * @param entry - path to the tsc-emitted client entry (e.g. `lib/types/client/index.js`).
 * @param options - see {@link ClientPluginBundleOptions}.
 * @returns a tsdown `UserConfig` producing `lib/client.js`.
 */
export function clientPluginBundle(id: string, entry: string, options: ClientPluginBundleOptions = {}): UserConfig {
  const externals = new Set([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS, ...requestedExternals(id, { external: options.clientExternal })])
  const isRequested = (specifier: string): boolean => externals.has(specifier)
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isRequested,
      alwaysBundle: (specifier: string) => !isRequested(specifier),
    },
    inputOptions: {
      resolve: {
        conditionNames: [
          (process.env.NODE_ENV ?? 'production') === 'development' ? 'development' : 'production',
          'browser', 'import', 'module', 'default',
        ],
        // rolldown's own platform-based defaults for these two
        // (`[['browser']]` / `['browser', 'module', 'main']`) only apply
        // when `resolve` is left untouched entirely; specifying
        // `conditionNames` above silently drops them, so a legacy (no
        // `exports` map) dependency's `browser` package.json field —
        // xlsx's `{"fs": false, ...}` builtin stub map, mammoth's
        // `./lib/unzip.js` → `./browser/unzip.js` file swap — never
        // applies, and its real Node `require("fs")`/`require("os")` calls
        // land in the closure-factory bundle verbatim, where the loader's
        // synthetic `require` has no seed word or registered factory for
        // them and throws at materialization. Restated explicitly here to
        // keep it.
        aliasFields: [['browser']],
        mainFields: ['browser', 'module', 'main'],
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'dsh-plugin-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isRequested(source)) return null
        if (VENDORED_LIBRARY.test(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        if (options.extraInlineSafe?.test(source) === true) return null
        throw new Error(
          `client plugin bundle purity: "${source}" is not in the default client externals or ${id}'s declared `
          + 'dsh.client.external, an inline-safe wire layer, or a generated /remote contribution — cross-plugin value '
          + 'imports are forbidden; declare a non-default module request or collaborate through cordis services '
          + '(type-only imports are erased and never reach this gate)',
        )
      },
    }, tscSourceMapPlugin(), {
      name: 'dsh-plugin-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFileAsync(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          classMap[local] = exp.name
        }
        return styleInjectionModule(id, fileId, code.toString(), classMap)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      // A dynamic import() inside plugin source (e.g. a replacement
      // plugin's own lazy pristine-apply fallback) must stay physically
      // inside this one output file: the closure-factory `require` the
      // banner below receives only resolves this bundle's declared
      // externals, not a second chunk file this bundler would otherwise
      // split off — no browser-side loader here ever fetches or registers
      // that second file. Disabling code splitting keeps rolldown's
      // evaluation laziness (the imported module's top-level code still
      // only runs the first time the import() expression executes) while
      // packing it into the single `client.js` this preset's
      // `entryFileNames` promises.
      codeSplitting: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}
