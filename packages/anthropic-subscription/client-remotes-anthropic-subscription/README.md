# dsh-plugins-client-remotes-anthropic-subscription

Mounts this bundle's own generated Remote contribution on the Client:
`dsh-plugins-api-authorization-controller`'s `authorization` namespace.
Without this, `ctx.remote.authorization` is never populated in the browser
even though the Host controller boots and registers the namespace correctly
— `dsh-typert-loader` only auto-discovers a package's Host `./typert` half
(its own README names this a known limitation); the Client `./remote` half
needs an explicit composition owner.

## Why its own plugin, not folded into the Settings UI panel

The canonical composition owner for a Remote contribution is
`@deepseek-ai/dsh-api-remotes`'s own Client assembly (see the vendored
[`docs/cookbook/adding-a-remote-api.md`](../../../packages/_vendor/deepseek-harness/docs/cookbook/adding-a-remote-api.md),
step 3) — a static, hand-curated list of `ctx.remote.$mount(contribution)`
calls. It's vendored, so this bundle can't add a row to it without patching
vendor source, which this repo's whole design forbids (see
`../../../ARCHITECTURE.md`).

`dsh-plugins-client-ui-settings-anthropic-subscription` (the eventual
consumer — Settings > Models sign-in panel) is still a Phase 0 scaffold,
not yet implemented. This package exists independently of it anyway,
following the same principle established for
[`dsh-plugins-client-remotes-workspace-git`](../../workspace-git/client-remotes-workspace-git/README.md):
whatever eventually consumes `remote.authorization` must never be the same
plugin that mounts it — a `$mount` failure would throw that plugin's whole
`apply()`, taking down everything else it renders along with it. This
plugin's `apply()` does nothing but mount, so a failure here stays local to
its own fiber; a future consumer injecting `remote.authorization` simply
stays pending per Cordis's ordinary lazy-activation semantics if this
plugin never mounts it, degrading only that one feature.

## Design

- The package's default `.` export (`src/index.ts`) is a Host-safe no-op;
  the real `apply`/`inject` live under `./client` (`src/client/index.ts`,
  declared via this package's own `dsh.client` field) — same two-entry-point
  shape every Client-face package in this repo uses, so the Host Loader's
  unconditional import of every row's `.` export stays import-safe.
- `inject = ['remote']` only — never `remote.authorization`, the key this
  plugin itself provides. Cordis won't call a plugin's `apply()` until its
  own declared `inject` is satisfied, so the plugin that mounts a
  `remote.<namespace>` key can never also inject that same key (a
  self-cycle Cordis's activation would deadlock on).

## Known Limitations and Deferred Work

- No consumer yet: `dsh-plugins-client-ui-settings-anthropic-subscription`
  hasn't been implemented, so this mount currently has nothing reading
  `ctx.remote.authorization`. Confirmed via `--dump-config` and a real `dsh
  web` boot that the mount completes without error regardless.
- No unit tests yet, consistent with the rest of this repo's packages at
  this stage (verified today by typecheck + build + a real `dsh` boot).
