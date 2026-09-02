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

`dsh-plugins-client-ui-settings-anthropic-subscription` (the Settings >
Models sign-in panel) consumes `ctx.remote.authorization`. Following the
same principle established for
[`dsh-plugins-client-remotes-workspace-git`](../../workspace-git/client-remotes-workspace-git/README.md),
that package is not the plugin that mounts this namespace: a `$mount`
failure would throw that plugin's whole `apply()`, taking down everything
else it renders along with it.

## The mount failure is caught, not thrown

Isolating the mount into its own plugin is not, by itself, enough to keep
the rest of the app working if the mount fails. This repo's Client loader
treats **any** top-level entry's `apply()` throwing as fatal to the entire
client boot — a blank "Failed to load plugins" page, with nothing else
rendering, for every feature in the app, not just this one. This was
discovered by deliberately breaking this mount during development (patching
the built `lib/client.js` to throw) and observing the whole app go blank,
which falsified an earlier, untested assumption that per-fiber isolation
alone would contain a `$mount` failure.

So `apply()` catches a `$mount` failure, logs it via `ctx.logger.error`, and
returns a no-op disposer instead of re-throwing. `dsh-plugins-client-ui-
settings-anthropic-subscription` injects `remote.authorization` in its own
`inject` array and simply stays pending forever per Cordis's ordinary
lazy-activation semantics when this plugin's mount never succeeds —
degrading only the Settings > Models sign-in panel, while the rest of the
app (chat, Workspace sidebar, other Settings sections) boots and works
normally.

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

- No unit tests yet, consistent with the rest of this repo's packages at
  this stage. Verified by typecheck + build, a real `dsh plugin add`/`dsh
  web` boot showing the mount succeed and the sign-in panel's host slot
  render, and a deliberate fault-injection test (see above) confirming the
  mount-failure path degrades gracefully instead of crashing the app.
