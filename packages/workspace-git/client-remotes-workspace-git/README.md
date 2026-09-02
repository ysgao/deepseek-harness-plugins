# dsh-plugins-client-remotes-workspace-git

Mounts this bundle's own generated Remote contributions on the Client:
`dsh-plugins-api-workspace-file-controller` and
`dsh-plugins-api-workspace-git-controller`. Without this, `ctx.remote
['workspace-files']`/`['workspace-git']` are `undefined` in the browser even
though both Host controllers boot and register their namespaces correctly —
`dsh-typert-loader` only auto-discovers a package's Host `./typert` half (its
own README names this a known limitation); the Client `./remote` half needs
an explicit composition owner, which every reference to these two exports
elsewhere in this bundle was only a type-only `import type {}` of, never a
runtime one.

## Why its own plugin, not folded into another package

The canonical composition owner for a Remote contribution is
`@deepseek-ai/dsh-api-remotes`'s own Client assembly (see the vendored
[`docs/cookbook/adding-a-remote-api.md`](../../../packages/_vendor/deepseek-harness/docs/cookbook/adding-a-remote-api.md),
step 3) — a static, hand-curated list of `ctx.remote.$mount(contribution)`
calls. It's vendored, so this bundle can't add rows to it without patching
vendor source, which this repo's whole design forbids (see
`../../../ARCHITECTURE.md`).

An earlier revision mounted both contributions from
`dsh-plugins-client-ui-workspace-enhanced`'s own `apply()` instead. That
package's `apply()` also registers the core `sidebar.workspaces`/
`conversation.hero.workspace` slots — the Workspace sidebar itself — so a
`$mount` failure there would have thrown the whole function and taken the
sidebar down with it. A plugin that adds an optional Files/git-status
feature must never be able to break the Workspace sidebar just by existing.

This package's `apply()` does nothing else, so a mount failure here stays
local to its own fiber. Every consumer
(`dsh-plugins-client-ui-workspace-files`,
`dsh-plugins-client-ui-conversation-files`) injects
`remote.workspace-files`/`remote.workspace-git` in its own `inject` array
and simply stays pending per Cordis's ordinary lazy-activation semantics if
this plugin never mounts them — degrading only the feature that needs those
two namespaces, never anything else in the app.

## Design

- The package's default `.` export (`src/index.ts`) is a Host-safe no-op;
  the real `apply`/`inject` live under `./client` (`src/client/index.ts`,
  declared via this package's own `dsh.client` field) — same two-entry-point
  shape every Client-face package in this repo uses, so the Host Loader's
  unconditional import of every row's `.` export stays import-safe. This
  package's `./client` code has no CSS/React dependency, so the split isn't
  load-bearing here the way it is for its siblings, but it's kept for
  consistency with the rest of this bundle.
- `inject = ['remote']` only — never the specific
  `remote.workspace-files`/`remote.workspace-git` keys this plugin itself
  provides. Cordis won't call a plugin's `apply()` until its own declared
  `inject` is satisfied, so the plugin that mounts a `remote.<namespace>`
  key can never also inject that same key (a self-cycle Cordis's activation
  would deadlock on).

## Known Limitations and Deferred Work

- No unit tests yet, consistent with the rest of this repo's packages at
  this stage (verified today by typecheck + build + a real `dsh web` boot).
