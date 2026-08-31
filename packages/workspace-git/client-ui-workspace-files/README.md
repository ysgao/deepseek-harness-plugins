# dsh-plugins-client-ui-workspace-files

The Files tree sidebar row (`FilesNode`), its in-app file preview
(`FileViewer`), and git status/action buttons (commit, discard, fetch,
pull `--rebase`, push, add file/folder) — ported from
`yga/deepseek-harness`'s direct edits to `dsh-client-ui-workspace`,
`dsh-api-workspace-controller`, and `dsh-client-ui-primitives` into this
out-of-tree package.

## Design

- The package's default `.` export (`src/index.ts`) is a Host-safe no-op;
  the real `apply`/`inject` live under `./client` (`src/client/index.ts`,
  declared via this package's own `dsh.client` field). Required, not just
  tidy: a real boot proved the Host Loader imports every `cordis.patch.yml`
  row's `.` export during composition, and this package's real code
  transitively imports `dsh-client-ui-primitives`' CSS Modules, which a
  plain Node ESM import can't resolve — see `../bundle-workspace-git/README.md`.
- Wire calls go through this repo's own `dsh-plugins-api-workspace-file-
  controller` and `dsh-plugins-api-workspace-git-controller` Typert
  namespaces (`ctx.remote['workspace-files']`, `ctx.remote['workspace-git']`),
  not a fork-extended `dsh-api-workspace-controller`.
- `FilesNode`/`FileViewer` are near-verbatim ports: same component tree, same
  props, same CSS. The only touches are import repointing (wire types now
  come from this repo's own controller packages; `WorkspaceId` from
  `@deepseek-ai/dsh-workspace`) and one behavior change forced by the real
  Typert protocol: `FileViewer`'s `stateFromError` now discriminates a
  `file-too-large` failure by `RemoteError.code` via `remoteErrorOf`
  (`@deepseek-ai/dsh-typert-protocol`) instead of the fork's own
  `WorkspaceFileBrowseError` wrapper class.
- `./src/icons.tsx` carries 7 glyphs (`IconArrowDownOutline14`,
  `IconArrowUpOutline14`, `IconChevronDuoUpOutline14`, `IconFilePlaceholder16`,
  `IconNewFile16`, `IconNewFolder16`, `IconUndoOutline14`) the fork added
  directly to `dsh-client-ui-primitives`. Kept local rather than depending on
  an upstream icon-set change: nothing outside the Files tree uses them.
- `./src/locales.ts` carries its own `workspace-files` locale namespace
  (registered via `ctx.locale.register`) rather than reusing
  `dsh-client-ui-workspace`'s `workspace` namespace, which the fork extended
  directly. The dictionary keys are unchanged (`files.*`), so the ported
  components' `t()` calls needed no rewrite — only the namespace they're
  bound against changed.
- `./src/service.ts` declares the optional `workspaceFilesNode` Context
  service (`ctx.get('workspaceFilesNode')`), following this codebase's own
  standing convention for optional cross-package services
  (`packages/AGENTS.md`: "Optional services use `ctx.get(name)`").
  `dsh-client-ui-conversation`'s `conversationFileOpener` is the same shape
  of seam, but it — provider and consumer both — is itself a fork addition,
  not pristine prior art; see below. `./src/index.ts`'s `apply(ctx)` provides
  the service; `./src/WorkspaceFilesNode.tsx` builds its `Component`, closing
  every Remote call and the bound `t` over `ctx`.
- `openPath` calls `session.openWorkspacePath` directly — a pristine Host
  Remote method (`packages/api/session-controller`), but one no pristine
  `dsh-client-ui-workspace` code calls today. This package is that method's
  first Client-side caller here, not a reuse of existing wiring.
- `openFileInSession` reads the optional `conversationFileOpener` service,
  provided by `../client-ui-conversation-enhanced` (an out-of-tree
  replacement for `dsh-client-ui-conversation`'s own row, not pristine
  prior art). It returns `false` — `FilesNode` then falls back to the
  in-app preview modal, by design, not a stub — only when that package
  isn't composed in, or when no session is current.

## Mount point

`../client-ui-workspace-enhanced` resolves `workspaceFilesNode` and renders
its `Component` — a full out-of-tree replacement for `dsh-client-ui-
workspace`'s own `sidebar.workspaces` registration (disabled and swapped
via `cordis.patch.yml`, not patched), not an upstream diff to that package.
See `../../../ARCHITECTURE.md`'s "Why replace the plugin instead of
patching it" for the rationale and `upstream-patches/0001-workspace-files-
node-optional-service.patch` for the smaller alternative kept as a
drafted-but-unsubmitted proposal.

This package's own `tsdown.config.ts` builds a real browser closure-factory
bundle (`lib/client.js`, `window.__ModuleLoader__.load({id, factory})`) via
`../../../tsdown.client-plugin-preset.ts` — a genuine `dsh plugin add`
target, confirmed present in a live `dsh web` combo-script manifest. See
`../../../ARCHITECTURE.md`'s "Confirmed working" section for exactly what
was checked (composition and the served manifest; not yet genuine browser
DOM rendering).

## Known Limitations and Deferred Work

- No unit tests yet, consistent with the rest of this repo's packages at
  this stage (verified today by typecheck + build + a real boot).
