import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile as readFileAsync, stat, utimes } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath, sep } from 'node:path'
import { Rolldown, type UserConfig } from 'tsdown'
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

/**
 * The other two stylesheet shapes `clientConfig()` handles, ported for the
 * same reason its CSS Modules plugin was: a package that inlines another
 * package's component tree inherits every stylesheet import in it, and a
 * third-party library's stylesheet is neither a CSS Module nor optional
 * (`@fortune-sheet/react/dist/index.css?inline` is the spreadsheet grid's
 * entire appearance). `?inline` yields the stylesheet TEXT to the importer,
 * which then owns where it goes; a plain `.css` import is a global
 * side-effect stylesheet and injects itself, exactly like a CSS Module's
 * companion injection.
 */
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-plugin-inline-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-plugin-global-css:'
const INLINE_CSS_QUERY = '?inline'

/** Published package-local chunk names, matching the client module loader's own on-demand route. */
const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

/** Escape a specifier for embedding in the generated-require match pattern. */
function escapeSpecifier(specifier: string): string {
  return specifier.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}

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

/**
 * Render package-local dynamic imports through the Client module loader's
 * asynchronous operation — the port of `clientConfig()`'s own
 * `asyncChunkRequirePlugin`. Without it a split bundle's `import()` compiles
 * to `Promise.resolve().then(() => require('./client.pdf.js'))`, and the
 * closure factory's synthetic `require` has no registered factory under that
 * name: the chunk exists on disk and is served, but nothing ever fetches it.
 * @returns the rolldown plugin rewriting those calls to `require.async(...)`.
 */
function asyncChunkRequirePlugin() {
  return {
    name: 'dsh-plugin-async-chunk-require',
    renderChunk(
      code: string,
      chunk: { dynamicImports: readonly string[] },
      outputOptions: { format?: string },
    ) {
      if (outputOptions.format !== 'cjs') return null
      const transformed = new Rolldown.RolldownMagicString(code)
      // Rolldown also emits a BARE `require("./client.<name>.js");` at the
      // top of a chunk that dynamically imports another — a side-effect
      // import, meant to run the target's top-level code in module order.
      // In this format that statement is always wrong: the loader's
      // synchronous `require` THROWS for anything but a declared external
      // ("missed the module table"), so it would fail the whole bundle at
      // load; and the chunk it names is lazy by construction, so its side
      // effects belong at `require.async` time, not before. Neutralizing it
      // is what makes the chunk lazy instead of fatal.
      //
      // `require\(` matches only the bare call: `require.async(` has no `(`
      // straight after `require`, so the rewrite below never sees this.
      const sideEffectRequire = /require\((['"])(\.\/client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js)\1\)/gu
      for (const match of [...code.matchAll(sideEffectRequire)]) {
        if (!CLIENT_CHUNK.test(match[2]!.slice(2))) continue
        transformed.overwrite(match.index, match.index + match[0].length, 'void 0')
      }
      for (const dynamicImport of chunk.dynamicImports) {
        const fileName = dynamicImport.startsWith('./') ? dynamicImport.slice(2) : dynamicImport
        if (!CLIENT_CHUNK.test(fileName)) continue
        const specifier = `./${fileName}`
        const call = new RegExp(
          `Promise\\.resolve\\(\\)\\.then\\(\\(\\)\\s*=>\\s*require\\((['"])${escapeSpecifier(specifier)}\\1\\)\\)`,
          'gu',
        )
        const matches = [...code.matchAll(call)]
        if (matches.length === 0) {
          throw new Error(`client plugin bundle: dynamic chunk ${JSON.stringify(specifier)} has no generated import expression`)
        }
        for (const match of matches) {
          transformed.overwrite(match.index, match.index + match[0].length, `require.async(${JSON.stringify(specifier)})`)
        }
      }
      return transformed.hasChanged() ? transformed : null
    },
    async writeBundle(
      outputOptions: { dir?: string },
      bundle: Record<string, { type: string; isEntry?: boolean; fileName: string }>,
    ) {
      const entry = Object.values(bundle).find(output => output.type === 'chunk' && output.isEntry === true)
      if (entry === undefined || outputOptions.dir === undefined) return
      const entryPath = resolvePath(outputOptions.dir, entry.fileName)
      const current = await stat(entryPath)
      const completedAt = new Date(Math.max(Date.now(), current.mtimeMs + 1))
      await utimes(entryPath, current.atime, completedAt)
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
  /**
   * Emit package-local lazy chunks (`client.<name>.js`) for `import()` calls
   * instead of packing them into the single entry bundle, reproducing
   * `clientConfig()`'s own chunked output.
   *
   * Off by default, which is the right default for a plugin whose whole
   * graph is small: one file, one request, no loader cooperation needed.
   * Turn it on for a package inlining a component tree with deliberately
   * lazy heavy bodies (a PDF runtime, a spreadsheet grid), where packing
   * them into the entry would move megabytes onto every boot. The client
   * module loader serves these on demand for ANY registered plugin id, out
   * of tree included — see `packages/client/modules/src/index.ts`'s
   * `CLIENT_CHUNK` route in the vendored harness.
   */
  codeSplitting?: boolean
  /**
   * Text prepended to one emitted file, by name — the port of
   * `clientBundle()`'s own `clientBanner`. Used to keep a bundled library's
   * license notice in the artifact that actually carries its code.
   * @param fileName - the emitted file's name (`client.js`, `client.pdf.js`, …).
   * @returns the banner text, or undefined to prepend nothing.
   */
  clientBanner?: (fileName: string) => string | undefined
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
    }, {
      name: 'dsh-plugin-css-text-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
        const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
        const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet
        return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFileAsync(fileId)
        const { code } = transform({ filename: fileId, code: source, minify: true })
        return `export default ${JSON.stringify(code.toString())};`
      },
    }, {
      name: 'dsh-plugin-css-global-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFileAsync(fileId)
        const { code } = transform({ filename: fileId, code: source, minify: true })
        return styleInjectionModule(id, fileId, code.toString())
      },
    }, ...(options.codeSplitting === true ? [asyncChunkRequirePlugin()] : [])],
    outputOptions: {
      entryFileNames: 'client.js',
      ...(options.codeSplitting === true ? { chunkFileNames: 'client.[name].js' } : {}),
      sourcemapExcludeSources: false,
      // A dynamic import() inside plugin source (e.g. a replacement
      // plugin's own lazy pristine-apply fallback) must stay physically
      // inside this one output file UNLESS the caller opts into
      // `codeSplitting`: the closure-factory `require` the banner below
      // receives only resolves this bundle's declared externals, not a
      // second chunk file this bundler would otherwise split off. Off,
      // rolldown's evaluation laziness is kept (the imported module's
      // top-level code still only runs the first time the import()
      // expression executes) while packing it into the single `client.js`
      // this preset's `entryFileNames` promises. On, the emitted chunks are
      // named the way the loader's package-local route expects and every
      // generated require of one is rewritten to `require.async(...)` by
      // `asyncChunkRequirePlugin` above — which is what actually fetches it.
      codeSplitting: options.codeSplitting === true,
      banner: (chunk: { isEntry: boolean; fileName: string }) => {
        const registration = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, `
          + `${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`
        const prefix = options.clientBanner?.(chunk.fileName)
        return prefix === undefined ? registration : `${prefix}\n${registration}`
      },
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}
