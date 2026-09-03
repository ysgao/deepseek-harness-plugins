# dsh-plugin-terminal (in-repo fork)

An in-repo fork of the upstream npm package
[`dsh-plugin-terminal@0.1.13`](https://github.com/siberiah2o/dsh-plugin-terminal)
(the original's own `README.md` is kept as `README.upstream.md` for
reference — feature list, screenshots, usage). This fork exists to fix
three issues found in that exact upstream version that the upstream
maintainer had not addressed, and to stop depending on the npm registry for
a plugin that controls a real shell on the user's machine.

## What changes, what doesn't

`src/index.js` (the host half), `package.json`, and — as of the locale fix
below — `src/client-main.js`/`src/client.js` (the client half) all change.
`src/client.css` and `src/client-main.js`'s non-locale logic are otherwise
unchanged from the upstream `0.1.13` npm tarball (upstream ships the host
and the built client bundle both under its own `lib/`; this fork moves them
under `src/` instead, since `lib/` is gitignored repo-wide here as build
output).

Unlike the first two fixes below, the client half is no longer hand-patched
in its pre-built, minified form. `src/client.js` is now a **real build
output**, produced from `src/client-main.js` and `src/locales.js` by
`build.mjs` (`node build.mjs`, or `pnpm run build` — needs `esbuild`, a
`devDependency`). Upstream shipped `lib/client.js` pre-built with no
equivalent build script in the published package, which is fine as long as
you only ever swap string literals by hand (safe: minified output preserves
string content byte-for-byte); it stops being safe the moment a change
needs to thread a new prop through the component tree, since that touches
minified variable scopes directly — see the locale fix below for exactly
that case. Regenerate `src/client.js` with `node build.mjs` after any
`src/client-main.js` or `src/locales.js` edit; don't hand-edit
`src/client.js` again.

- **Unauthenticated terminal control (the important one).** Upstream's
  host half gated its own `ctx.webServer` routes (session
  list/create/input/restart/resize/delete, plus the WS streaming upgrade)
  with a hand-rolled `sameOrigin(req)` check that treated a request with no
  `Origin` header as automatically trusted ("non-browser clients (curl)").
  `ctx.webServer` is a bare `node:http` router with no authentication of its
  own — the rest of the app's own token/cookie gate on `/` does not extend
  to routes a plugin registers itself. The result, confirmed live against a
  real `dsh web` server: `curl` with zero cookie, zero token, and no Origin
  header could list every live session (id, shell, cwd), spawn a new shell,
  and write arbitrary keystrokes into any session's PTY — full command
  execution as the logged-in user, from any local, unauthenticated caller,
  completely bypassing the app's own auth. Fixed by replacing `sameOrigin()`
  with `ctx.connection.requestRejection(req)` (this fork adds `'connection'`
  to `inject`) — the same Host/Origin fence plus signed-cookie check the
  rest of the app's own routes go through, per
  `@deepseek-ai/dsh-client-connection`'s own documented contract for
  exactly this case ("Apply Connection's Host/Origin checks and browser
  authentication to another Web route"). Applied at both call sites: the
  main HTTP route handler and the per-session WS upgrade handler.
- **Broken `node-pty` prebuild.** The published `node-pty@1.1.0` tarball
  (verified via `npm pack node-pty@1.1.0`, not just this one install) ships
  `prebuilds/darwin-*/spawn-helper` without its executable bit, so every
  `posix_spawn` to create a new terminal fails with `posix_spawnp failed.`
  on macOS/Linux — the "+" button is dead on a fresh install, not just this
  machine. Fixed by pinning `node-pty` to `1.2.0-beta.15` (`dependencies`),
  the same exact pin `@deepseek-ai/dsh-subprocess-local` already uses for
  its own `ctx.subprocess.spawnTerminal()` in this monorepo's vendored
  harness — same `spawn`/`onData`/`onExit`/`resize`/`kill` API surface, so
  no plugin-code changes were needed for this half of the fix.
- **Every UI string hardcoded in Simplified Chinese, no locale awareness at
  all.** Upstream's client half never called into any locale system —
  every button title, tab label suffix, and empty-state message was a
  literal Chinese string, unconditionally, regardless of the user's actual
  locale. Every other client package in this monorepo (e.g.
  `dsh-plugins-client-ui-workspace-files`) registers a `zh`/`en` dictionary
  pair via `ctx.locale.register` and calls `t('key', params)` instead.
  Fixed the same way: `src/locales.js` holds the `terminal-panel` namespace's
  `en`/`zh` dictionaries (16 keys, the original Chinese text preserved as
  the `zh` values — nothing lost, just made opt-in); the plugin's `apply`
  (added to `build.mjs`'s hand-written wrapper, not the bundled component)
  does `ctx.locale.register('terminal-panel', { zh, en })`, binds
  `t = ctx.locale.bind('terminal-panel')`, and passes `t` as a prop into the
  panel component (`'locale'` added to both the runtime `inject` array and
  `package.json`'s `dsh.client.inject`). Inside `client-main.js`, every
  hardcoded string became a `t('terminal-panel.xxx', params)` call using
  `{param}` interpolation instead of raw concatenation (e.g. tab titles,
  restart hints) — the same convention `'files.git.changedCount': '{n}
  changed files'` uses elsewhere in this repo. One local naming collision
  had to be resolved first: the component used the identifier `t` as its
  per-tab loop variable throughout (`tabs.map((t) => ...)`), which would
  have shadowed a `t` translate prop of the same name — renamed every such
  loop variable to `tab` (matching `TermPane`'s own prop name) so `t` was
  free for the translate function, consistent with this repo's convention.

Not changed and not re-audited beyond the original review: dependency
versions for `@xterm/*` and `ws`, the WS session-id design (unguessable
`t<counter>-<uuid>` ids — still relevant defense in depth even with real
auth in front), the on-disk scrollback logs under
`$DSH_HOME/plugin-data/terminal/logs/*.log` (plaintext, standard file
permissions — still worth knowing they exist if a session's output included
secrets).

## Why fork instead of patching `node_modules` or using `pnpm patch`

The auth fix is real application logic (not a one-line permission flip like
the `node-pty` half), and this plugin runs a real shell — patching it in an
external npm-managed `node_modules` means the fix has no code review, no
git history, and vanishes on `dsh plugin update` (returning to the
vulnerable behavior silently) or on any workspace reinstall. Vendoring it
here follows this repo's own established pattern (`workspace-git`,
`anthropic-subscription`): a third-party-shaped capability owned and
reviewed as first-party code, wired into a profile via `link:` instead of a
registry version. The tradeoff: this repo is now responsible for noticing
future upstream fixes (e.g. a `node-pty` CVE) itself, rather than getting
them from an upstream plugin bump.

## Wiring a profile to this fork

In the profile's `package.json` (e.g. `~/.dsh/profiles/web/package.json`):

```json
{
  "dependencies": {
    "dsh-plugin-terminal": "link:/absolute/path/to/deepseek-harness-plugins/packages/terminal/dsh-plugin-terminal"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-plugin-terminal"]
    }
  }
}
```

then `pnpm install` in the profile directory. The package name is
unchanged from upstream (`dsh-plugin-terminal`), so no other profile
config, `cordis.patch.yml`, or client-injection reference needs to change.

## Verification

- Reproduced the auth bypass against a real running `dsh web` server before
  the fix: unauthenticated `GET .../terminal-panel/sessions`,
  `POST .../sessions`, and `POST .../sessions/<id>/input` all succeeded with
  no cookie, no token, no Origin header; the injected input landed in the
  live PTY's buffer.
- `npm pack node-pty@1.1.0` and inspecting the tarball directly (not just
  the local install) confirmed `spawn-helper` ships without its executable
  bit in the published package itself — not local corruption. `npm pack
  node-pty@1.2.0-beta.15` confirmed that version ships it correctly
  (`-rwxr-xr-x`).
- The fixed `src/index.js`'s auth logic was first verified against a fake
  cordis `ctx` (real `apply()`, stubbed `webServer`/`connection`) without
  touching the user's then-live `dsh web` server: an unauthenticated request
  (`ctx.connection.requestRejection` returning `401`) is rejected on both the
  HTTP route and the WS upgrade route before any session lookup; an
  authenticated request (`requestRejection` returning `undefined`) is
  allowed through to the real route logic.
- Then verified end-to-end against a real `dsh web` restart with this fork
  active: the exact same unauthenticated `curl` calls that worked during the
  original audit (`GET .../sessions`, `POST .../sessions`) now both return
  `401 {"error":"authentication required"}`; a request carrying the real
  signed session cookie (obtained via the normal token exchange on `/`) can
  still list, create, and delete sessions normally.
- The rebuilt `src/client.js` (locale fix) was verified with a standalone
  Node smoke test — a minimal `React.createElement`/hook shim plus a fake
  `ctx.locale`/`ctx.slots`, no browser or real `dsh web` server involved —
  covering the collapsed bar, the expanded empty panel, and a two-tab
  scenario (one exited) in both `en` and `zh`: every rendered string
  resolves to real localized text (never a raw `terminal-panel.xxx` key),
  `{name}`/`{count}` interpolation substitutes correctly (e.g. `"/bin/zsh 2
  exited, click ⟳ to restart"`, `"Terminal · 2"`), and switching the fake
  locale between `en`/`zh` changes every string with no code changes. Not
  yet re-verified against a live `dsh web` boot with a real browser — do
  that (both locales) before trusting this fully.
