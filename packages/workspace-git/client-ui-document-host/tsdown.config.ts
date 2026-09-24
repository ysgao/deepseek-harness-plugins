import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Rolldown, defineConfig, type UserConfig } from 'tsdown'
import { clientPluginBundle } from '../../../tsdown.client-plugin-preset.ts'

/**
 * Two configs: the Host-safe no-op (`.`, plain Node ESM) and the real
 * browser bundle (`./client`), same shape as every other Client package
 * here — plus the three build-time inputs the vendored preview engine's
 * own `tsdown.config.ts` supplies and this repo's shared preset does not
 * know about, ported here because inlining that engine means inheriting
 * its build contract:
 *
 * 1. `pdfjs-dist/build/pdf.worker.min.mjs?raw` — the worker as SOURCE TEXT.
 *    A closure-factory bundle has no module URL to resolve a Worker file
 *    against, so pdf.js is handed its worker as a string instead.
 * 2. `__DSH_PDFJS_ASSETS__` — cmaps, standard fonts and wasm, base64, as a
 *    define. Same reason: no URL to fetch them from at runtime.
 * 3. `./worker.ts?raw` — the Excel parser, separately rolled up to an IIFE
 *    string so the spreadsheet parse runs off-thread without the loader
 *    having to own a second module graph.
 *
 * Everything is resolved from the VENDOR package's own directory, never
 * this one: `pdfjs-dist`, `exceljs`, `xlsx` and friends are that package's
 * devDependencies, and this package deliberately does not re-declare them —
 * re-declaring would let the two drift to different versions of a library
 * whose build output this config embeds verbatim.
 *
 * Code splitting is re-enabled (the shared preset turns it off) so the pdf
 * and excel bodies stay the lazy `client.pdf.js`/`client.excel.js` chunks
 * upstream designed them to be, instead of several megabytes landing in
 * every boot. Those chunks are fetched on demand by the client module
 * loader's package-local chunk route, which matches `client.<name>.js`
 * beside any registered plugin's own bundle — out-of-tree ids included
 * (see the vendored `packages/client/modules/src/index.ts`, `CLIENT_CHUNK`
 * and `chunkResponse`).
 */

const ID = 'dsh-plugins-client-ui-document-host'
const PREVIEW = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'

const requireHere = createRequire(import.meta.url)
const previewRoot = dirname(requireHere.resolve(`${PREVIEW}/package.json`))
/** Module resolution rooted in the vendor package, so its own dependency tree answers. */
const requireFromPreview = createRequire(join(previewRoot, 'noop.js'))

const workerSpecifier = 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
const workerModule = '\0dsh-pdf-worker.mjs'
const excelSpecifier = './worker.ts?raw'
const excelModule = '\0dsh-excel-worker-source'

/** Keep font mappings and image decoders in the same artifact as their PDF.js runtime. */
function pdfAssets(): string {
  const root = dirname(requireFromPreview.resolve('pdfjs-dist/package.json'))
  return JSON.stringify(Object.fromEntries([
    ['cMapUrl', 'cmaps'], ['standardFontDataUrl', 'standard_fonts'], ['wasmUrl', 'wasm'],
  ].map(([kind, directory]) => [kind, Object.fromEntries(
    readdirSync(join(root, directory!)).filter(name => !name.startsWith('LICENSE')).sort()
      .map(name => [name, readFileSync(join(root, directory!, name)).toString('base64')]),
  )])))
}

/** License files for PDF.js and the data embedded beside its runtime. */
function pdfLicenseFiles(root: string): string[] {
  return ['LICENSE', ...['cmaps', 'standard_fonts', 'wasm'].flatMap(directory =>
    readdirSync(join(root, directory)).filter(name => name.startsWith('LICENSE')).sort()
      .map(name => `${directory}/${name}`),
  )]
}

/** Keep every bundled PDF.js license visible in this artifact, as the vendor build does in its own. */
function pdfLicenseBanner(): string {
  const root = dirname(requireFromPreview.resolve('pdfjs-dist/package.json'))
  const notice = pdfLicenseFiles(root).map(name =>
    `${name}\n\n${readFileSync(join(root, name), 'utf8').trimEnd()}`,
  ).join('\n\n')
  return ['//! Bundled PDF.js license notices', ...notice.split('\n').map(line => `// ${line}`)].join('\n')
}

/** FortuneSheet omits its repository license from the npm payload; the vendor package keeps a copy. */
function excelLicenseBanner(): string {
  const fortune = readFileSync(join(previewRoot, 'licenses/FortuneSheet.txt'), 'utf8')
  const excel = readFileSync(join(dirname(requireFromPreview.resolve('exceljs/package.json')), 'LICENSE'), 'utf8')
  const xml = readFileSync(join(dirname(dirname(requireFromPreview.resolve('fast-xml-parser'))), 'LICENSE'), 'utf8')
  const csv = readFileSync(join(dirname(requireFromPreview.resolve('papaparse/package.json')), 'LICENSE'), 'utf8')
  const zip = readFileSync(join(dirname(requireFromPreview.resolve('fflate/package.json')), 'LICENSE'), 'utf8')
  const xlsRoot = dirname(requireFromPreview.resolve('xlsx'))
  const xls = readdirSync(xlsRoot).filter(name => /^(LICENSE|NOTICE)(\.|$)/u.test(name)).sort()
    .map(name => readFileSync(join(xlsRoot, name), 'utf8')).join('\n')
  return ['//! Bundled spreadsheet license notices', ...`${fortune}\n${excel}\n${xml}\n${csv}\n${zip}\n${xls}`.trimEnd().split('\n').map(line => `// ${line}`)].join('\n')
}

/** The dynamic client factory has no module URL from which to resolve a Worker file. */
const pdfWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-pdf-worker-source',
  resolveId(source: string) {
    return source === workerSpecifier ? workerModule : null
  },
  load(this: { addWatchFile: (path: string) => void }, id: string) {
    if (id !== workerModule) return null
    const path = requireFromPreview.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    this.addWatchFile(path)
    return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`
  },
}]

/** Embed a self-contained browser parser without giving it a loader-module dependency. */
const excelWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-excel-worker-source',
  resolveId(source: string) { return source === excelSpecifier ? excelModule : null },
  async load(this: { addWatchFile: (path: string) => void; resolve: (source: string, importer: string) => unknown }, id: string) {
    if (id !== excelModule) return null
    const parent = this
    const worker = await Rolldown.rolldown({
      input: join(previewRoot, 'src/client/excel/worker.ts'), platform: 'browser',
      resolve: { mainFields: ['browser', 'module', 'main'], aliasFields: [['browser']] },
      transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
      plugins: [{
        name: 'dsh-excel-worker-dependencies',
        async resolveId(source: string, importer: string | undefined) {
          // The outer build's license analysis must also see imports embedded in Worker text.
          if (importer?.startsWith(join(previewRoot, 'src')) === true && !source.startsWith('.')) await parent.resolve(source, importer)
          return null
        },
      }],
    })
    try {
      const result = await worker.generate({ format: 'iife', minify: true })
      const chunk = result.output[0]
      if (chunk?.type !== 'chunk') throw new Error('Excel parser did not emit a JavaScript chunk')
      for (const path of Object.keys(chunk.modules)) this.addWatchFile(path)
      return `export default ${JSON.stringify(chunk.code)};`
    } finally { await worker.close() }
  },
}]

const client = clientPluginBundle(ID, 'lib/types/client/index.js', {
  // This package runs the vendored preview engine's own registrations from
  // its own source tree. Safe to inline for the same reason workspace-
  // enhanced inlines dsh-client-ui-workspace's: wherever this package is
  // installed the original row is disabled, so there is no sibling instance
  // to duplicate shared identity against.
  extraInlineSafe: /^@deepseek-ai\/dsh-client-ui-sidebar-documentpreview\/src\//,
  codeSplitting: true,
  clientBanner: fileName => fileName.endsWith('client.pdf.js') ? pdfLicenseBanner()
    : fileName.endsWith('client.excel.js') ? excelLicenseBanner() : undefined,
})

export default defineConfig([
  {
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    ...client,
    plugins: [client.plugins, pdfWorker, excelWorker],
    define: { ...client.define, __DSH_PDFJS_ASSETS__: pdfAssets() },
  },
])
