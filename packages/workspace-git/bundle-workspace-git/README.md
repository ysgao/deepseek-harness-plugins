# dsh-plugins-bundle-workspace-git

**Status: Confirmed working** — installs cleanly, and a real boot succeeds
(both a clean `exit 0` under `acp` and a crash-free extended run under
`web-app`; see ARCHITECTURE.md for exactly what "confirmed" covers and
doesn't).

The installable `dsh --profile` patch layer for the File manager + git
feature. Install into a `web-app`-derived profile with:

```sh
dsh plugin --profile web-app add dsh-plugins-bundle-workspace-git
```

`cordis.patch.yml` inserts five rows over the target profile's existing
composition — no edit to `packages/bundle/base` or `packages/bundle/web-app`
in the vendored harness:

- `workspace-registry-seam` (`@deepseek-ai/dsh-workspace`) — only `web-app`
  mounts this by default; this bundle mounts it itself so it's
  self-sufficient regardless of target profile (mirrors
  `dsh-plugins-bundle-anthropic-subscription`'s `authorization-seam`).
  **Installing into a profile that already mounts it (`web-app` does)
  duplicate-mounts the same service and conflicts** — this bundle assumes
  it's the one adding the row; drop it if the target already carries one.
- `workspace-file-controller` / `workspace-git-controller` — the two Host
  Typert RPC namespaces.
- `conversation-files` — the File tab, into the pristine `conversation.view`
  slot (no upstream diff needed).
- `workspace-files-node` — the sidebar Files tree's `workspaceFilesNode`
  optional service (no consumer until
  `../../../upstream-patches/0001-workspace-files-node-optional-service.patch`
  lands upstream — composes cleanly, renders nothing yet).

See [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) for the full package
inventory and each package's own README for design detail.

## A finding worth knowing if you touch this bundle's Client rows

The Host Loader imports every `cordis.patch.yml` row's package **default**
(`.`) export during composition — even for a row whose package only
declares a `dsh.client` (browser-only) face. `dsh-plugins-client-ui-
workspace-files` and `dsh-plugins-client-ui-conversation-files` originally
put their real `apply`/`inject` directly on `.`, which transitively imports
`dsh-client-ui-primitives`' CSS Modules — and a plain Node ESM import can't
resolve `.css` (`ERR_UNKNOWN_FILE_EXTENSION`), so the very first real boot
attempt against this bundle crashed immediately. Both packages now split
into a Host-safe no-op at `.` and the real code under `./client` (declared
via `dsh.client` in `package.json`, resolved by the browser-side loader
only) — the exact two-entry-point shape `yga/deepseek-harness`'s own
`ui-conversation-files` package already used, which is now clear *why* it
existed. Any future Client package added to this bundle needs the same
split if it (transitively) imports a CSS Module.
