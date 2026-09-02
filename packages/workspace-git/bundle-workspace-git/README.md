# dsh-plugins-bundle-workspace-git

**Status: Confirmed working** — installs cleanly; a real `dsh web` server
boots and serves a working page whose combo-script manifest confirms every
row composed correctly, including both the `ui-workspace` and
`ui-conversation` disable/replace pairs. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md)'s "Confirmed working" section
for exactly what "confirmed" covers and doesn't (genuine browser DOM
rendering is not yet verified).

The installable `dsh --profile` patch layer for the File manager + git
feature. **Install `@deepseek-ai/dsh-web-app`'s own bundle first** — this
bundle's `disabled: true` row targets the `ui-workspace` row that bundle
inserts, and `cordis.patch.yml` operations apply in `dsh.profile.bundles`
order, so installing this bundle before `dsh-web-app` leaves nothing to
disable (a harmless no-op warning, not an error, but the replacement then
never actually swaps in):

```sh
dsh plugin --profile web-app add @deepseek-ai/dsh-web-app   # first
dsh plugin --profile web-app add dsh-plugins-bundle-workspace-git   # second
```

`cordis.patch.yml` disables two existing rows and inserts six over the
target profile's existing composition — no edit to `packages/bundle/base`
or `packages/bundle/web-app` in the vendored harness:

- `ui-workspace` (`disabled: true`) — `dsh-client-ui-workspace`'s own
  `sidebar.workspaces`/`conversation.hero.workspace` registrations, turned
  off wherever this bundle installs, so `workspace-enhanced` (below) can
  take over the same slots without a duplicate-registration conflict. See
  ARCHITECTURE.md's "Why replace the plugin instead of patching it."
- `ui-conversation` (`disabled: true`) — `dsh-client-ui-conversation`'s own
  conversation-shell registration, turned off the same way so
  `conversation-enhanced` (below) can take over without conflicting.
- `workspace-file-controller` / `workspace-git-controller` — the two Host
  Typert RPC namespaces. Both declare `static inject = ['workspaceRegistry']`,
  resolved by the target profile's own `web-app` bundle (its `workspace` row)
  — this bundle does **not** mount `@deepseek-ai/dsh-workspace` itself.
  `dsh-plugins-bundle-anthropic-subscription`'s `authorization-seam` row is
  not a precedent here: no shipped bundle mounts `@deepseek-ai/dsh-authorization`
  anywhere, so that seam fills a real gap, while `web-app` always already
  mounts `@deepseek-ai/dsh-workspace` — self-mounting it here only ever
  duplicate-registers it (`service "workspaceRegistry" has been registered`),
  confirmed by a real boot; see "Two findings worth knowing" below.
- `conversation-enhanced` — the `conversationFileOpener` cross-session
  bridge; the actual conversation-shell replacement. Lets the sidebar Files
  tree (below) dock a file into the current session's File tab instead of
  always falling back to its own in-app preview modal.
- `conversation-files` — the File tab, into the pristine `conversation.view`
  slot (no upstream diff needed for the tab itself).
- `workspace-files-node` — the sidebar Files tree and its optional
  `workspaceFilesNode` Context service.
- `workspace-enhanced` — consumes that service and renders the Files row;
  the actual `sidebar.workspaces`/`conversation.hero.workspace` replacement.

See [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) for the full package
inventory and each package's own README for design detail.

## Two findings worth knowing before you touch this bundle

**The Host Loader imports every row's package default (`.`) export during
composition** — even for a row whose package only declares a `dsh.client`
(browser-only) face. Every Client package here originally put its real
`apply`/`inject` directly on `.`, which transitively imports
`dsh-client-ui-primitives`' CSS Modules — and a plain Node ESM import can't
resolve `.css` (`ERR_UNKNOWN_FILE_EXTENSION`), so the very first real boot
attempt against this bundle crashed immediately. Every Client package here
now splits into a Host-safe no-op at `.` and the real code under `./client`
(declared via `dsh.client` in `package.json`, resolved by the browser-side
loader only) — the exact two-entry-point shape `yga/deepseek-harness`'s own
`ui-conversation-files` package already used. Any future Client package
added to this bundle needs the same split if it (transitively) imports a
CSS Module.

**`apps/web`'s Vite frontend is built during `pnpm run build`.** `dsh --profile
<name>` (no explicit mode) runs `dsh web`, which serves
`packages/_vendor/deepseek-harness/apps/web/dist/`. This is built automatically
when building the vendored submodule via `pnpm run build` (or `pnpm run
build:vendor` from the workspace root).

**An earlier revision of this bundle self-mounted `@deepseek-ai/dsh-workspace`
under a `workspace-registry-seam` row**, on the (wrong, for this specific
service) theory that mirroring `authorization-seam`'s self-sufficiency was
free. A real boot against `web-app` — which always already mounts it as its
own `workspace` row — immediately threw `service "workspaceRegistry" has
been registered`. A `disabled: !!js ctx.get('workspaceRegistry') !== undefined`
guard was considered and rejected: `EntryGroup.create`
(`vendor/loader/src/config/group.ts`) activates every entry in a layer
through `Promise.allSettled` — concurrently, with no ordering guarantee
against `web-app`'s own `workspace` row — so that guard would only turn a
guaranteed crash into a racy one. Dropping the row entirely is the only
deterministic fix, confirmed by a real scratch-profile boot (clean start, no
`workspaceRegistry` error, page served) after removing it.
