# dsh-plugins-client-ui-workspace-files

The Files tree sidebar row (`FilesNode`), its in-app file preview
(`FileViewer`), and git status/action buttons (commit, discard, fetch,
pull `--rebase`, push, add file/folder) — ported from
`yga/deepseek-harness`'s direct edits to `dsh-client-ui-workspace`,
`dsh-api-workspace-controller`, and `dsh-client-ui-primitives` into this
out-of-tree package.

## Design

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
  service (`ctx.get('workspaceFilesNode')`), mirroring
  `dsh-client-ui-conversation`'s own `conversationFileOpener` optional
  service already present in this codebase. `./src/index.ts`'s `apply(ctx)`
  provides it; `./src/WorkspaceFilesNode.tsx` builds its `Component`, closing
  every Remote call and the bound `t` over `ctx`.
- `openPath` reuses the pristine `session.openWorkspacePath` Remote method
  `dsh-client-ui-workspace`'s own plugin already calls for the identical
  capability — not something this package needs to add.
- `openFileInSession` reads the same optional `conversationFileOpener`
  service `dsh-client-ui-workspace`'s own plugin already reads. Until the
  File tab package (a separate future port) is composed in, it always
  returns `false`, and `FilesNode` falls back to the in-app preview modal —
  by design, not a stub: this is `FilesNode`'s own documented degradation
  path for exactly this case.

## Mount point (upstream-ready diff)

This package builds, typechecks, and provides its service today, but has no
mount point in a real `dsh-client-ui-workspace` build until a small diff to
`packages/client/ui-workspace/src/client/{index.ts,rows/WorkspaceBrowser.tsx}`
lands upstream:

- `index.ts`'s `apply(ctx)` resolves `const filesNode = ctx.get('workspaceFilesNode')`
  once (`undefined` when this package isn't composed in) and threads it down
  through `WorkspaceBrowserInjected`/`SessionTreeProps`, mirroring
  `conversationFileOpener`'s own resolution three lines away in the same file.
- `WorkspaceBrowser.tsx`'s row loop renders
  `filesNode?.Component({ workspaceId: group.workspaceId, rootPath: group.cwd, currentSessionId: current })`
  in the exact row `FilesNode` occupied in the fork: the first row under a
  real Workspace group's header, sibling to its Session rows, the selected
  Workspace's own directory as the tree's implicit root — matching the
  layout the user asked to keep, not the alternative right-side-pane option.

Same delivery mechanism as the Settings UI panel (see
`../../anthropic-subscription/client-ui-settings-anthropic-subscription`):
a small static upstream PR, not a dynamically-loaded `dsh plugin add` bundle
— which is why this package's `tsdown.config.ts` builds a plain library, not
a browser closure-factory bundle.

## Known Limitations and Deferred Work

- No mount point yet (see above) — this is the primary remaining gap.
- `openFileInSession` always returns `false` until the File tab package is
  ported, so every file open falls back to the in-app preview modal even
  when a session is selected.
- No unit tests yet, consistent with the rest of this repo's packages at
  this stage (verified today by typecheck + build only).
