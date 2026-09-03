/**
 * Rebuilds src/client.js from src/client-main.js. Added by this fork —
 * upstream shipped a pre-built lib/client.js with no equivalent build
 * script in the published package, so client.js used to be hand-patched
 * directly for any change; that stopped being safe once this fork started
 * threading a locale `t` prop through the bundle instead of only swapping
 * string literals (see README.md's "In-repo fork" section).
 *
 * Bundles client-main.js alone (react is loaded through the host's own
 * module system, so it's the one thing left external — everything else,
 * including @xterm/*, is bundled in, matching upstream's own client.js).
 * The locale dictionaries and the plugin-registration wrapper
 * (apply/inject, ctx.locale.register/bind, ctx.slots.register) are NOT
 * part of the bundle — they're appended as plain JS around it, exactly
 * matching how upstream's own build wrapped its bundle in
 * `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`.
 *
 * Run with: node build.mjs
 */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zh, en } from './src/locales.js'

const OUT_PATH = fileURLToPath(new URL('./src/client.js', import.meta.url))
const NS = 'terminal-panel'

const result = await build({
  entryPoints: [fileURLToPath(new URL('./src/client-main.js', import.meta.url))],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  minify: true,
  external: ['react'],
  write: false,
})

const bundle = result.outputFiles[0].text

const output = `/**
 * dsh-plugin-terminal - client bundle (xterm.js edition, self-contained).
 * Built by build.mjs from src/client-main.js. Do not edit by hand.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-terminal',
  factory: (require) => {
    var module = { exports: {} };
var exports = module.exports;
${bundle}
var __panel = module.exports.TerminalPanel ?? module.exports.default;
var TERMINAL_PANEL_NS = ${JSON.stringify(NS)};
var zh = ${JSON.stringify(zh)};
var en = ${JSON.stringify(en)};
return {
  apply: function (ctx) {
    ctx.locale.register(TERMINAL_PANEL_NS, { zh: zh, en: en });
    var t = ctx.locale.bind(TERMINAL_PANEL_NS);
    ctx.slots.inject('conversation.input.dock', function () {
      return ctx.slots.register(
        { name: 'conversation.input.dock', id: 'terminal', order: 10 },
        function (props) { return __panel(Object.assign({}, props, { t: t })); }
      );
    });
  },
  inject: ['slots', 'locale'],
};
  },
});
`

writeFileSync(OUT_PATH, output)
console.log(`wrote ${OUT_PATH} (${(output.length / 1024).toFixed(1)} KB)`)
