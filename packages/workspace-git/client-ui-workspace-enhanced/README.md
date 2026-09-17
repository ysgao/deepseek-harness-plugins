# dsh-plugins-client-ui-workspace-enhanced

An out-of-tree **replacement** for `dsh-client-ui-workspace`'s own
`sidebar.workspaces`/`conversation.hero.workspace` registrations — not a
patch to that package. `dsh-plugins-bundle-workspace-git`'s
`cordis.patch.yml` disables the original row and inserts this one in its
place. See `../../../ARCHITECTURE.md`'s "Why replace the plugin instead of
patching it" for the full rationale.

## What changes, what doesn't

The only behavior difference from the original `dsh-client-ui-workspace`:
a Files sibling row (`workspaceFilesNode`'s `Component`, provided by
`dsh-plugins-client-ui-workspace-files`) renders as the first row under
each real Workspace group's header, before its Session rows.

To get there:

- `src/WorkspaceBrowser.tsx` is a near-verbatim fork of the original
  package's `rows/WorkspaceBrowser.tsx` — same 1300+ lines of session-tree,
  drag-reorder, search, and dialog logic, untouched. The only edits: import
  paths repointed to `@deepseek-ai/dsh-client-ui-workspace/src/client/*`
  (that package's own source, not a copy), a `filesNode` field threaded
  through `SessionTreeProps`/the outer component's props, and one render
  block inserted right after the group header row.
- `src/apply.ts` is likewise a near-verbatim fork of the original's own
  `index.ts` `apply()` — same service construction
  (`UiWorkspaceService`, `createWorkspaceViewStore`), same locale
  registration (same `workspace` namespace, same dictionaries, imported
  from the original), same `WorkspacePicker` registration for
  `conversation.hero.workspace` (completely unmodified), same top-level
  `inject` array (now including `'layout'` — `UiWorkspaceService`'s own
  `openSession` dismisses the active layout panel through it, and its
  `open`/`forkSession` injected callbacks now delegate to
  `UiWorkspaceService.openSession`/`.forkSession` rather than calling
  `ctx.sessions` directly, mirroring the pristine plugin's own current
  `open`/`forkSession` wiring). The only addition: `filesNode:
  ctx.get('workspaceFilesNode')` in the browser's injected props.
- `WorkspacePicker`, `UiWorkspaceService`, `createWorkspaceViewStore`,
  `tree.ts`'s group-deriving functions, `Rows.tsx` (`ProjectRowItem`,
  `SessionNodeItem`), and the `workspace` locale dictionaries are all
  imported directly from `@deepseek-ai/dsh-client-ui-workspace/src/client/*`
  — real values, not duplicated source. That package declares
  `"./src/*": "./src/*"` in its own `exports` map (a convention this whole
  codebase uses), which is what makes this possible without touching the
  vendored submodule.

## Why inlining the original package's internals is safe here

The closure-factory bundle (`tsdown.config.ts`) passes `extraInlineSafe:
/^@deepseek-ai\/dsh-client-ui-workspace\/src\//` to
`../../../tsdown.client-plugin-preset.ts`'s purity gate, which otherwise
forbids inlining another package's `@deepseek-ai/*` internals (the
general case that protects against two independently-loaded bundles each
carrying their own copy of shared runtime state). That protection doesn't
apply here: this package's `cordis.patch.yml` row **disables** the
original `dsh-client-ui-workspace` browser plugin wherever this one is
installed, so there is never a second, live instance of its state (the
view store, the navigation service) running alongside this one to
duplicate identity against.

## Verification

`typecheck` + `build` are clean; the closure-factory bundle
(`lib/client.js`) is byte-verified against the expected
`window.__ModuleLoader__.load({id, factory})` wire format, with all three
of the original's own CSS Modules (`WorkspaceBrowser.module.css`, plus
`Rows.module.css` and `WorkspacePicker.module.css` via the unchanged,
inlined `Rows.tsx`/`WorkspacePicker.tsx`) correctly transformed and
injecting. A real `dsh --profile <name> --dump-config` against
`dsh-plugins-bundle-workspace-git` shows `ui-workspace` disabled and this
package inserted with no composition errors; a real `dsh web` boot serves
a working page whose combo-script manifest lists this package's
`client.js` and **omits** `@deepseek-ai/dsh-client-ui-workspace/client.js`
— confirming the disable took effect at the wire level. See
`../../../ARCHITECTURE.md`'s "Confirmed working" section for exactly what
was and wasn't checked (genuine browser-side DOM rendering is still
unverified).
