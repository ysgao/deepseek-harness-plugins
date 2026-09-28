# dsh-plugins-client-ui-conversation-files

The File tab in the conversation view: in-app file preview, edit, and
side-by-side git diff for a session's opened workspace paths — ported from
`yga/deepseek-harness`'s `@deepseek-ai/dsh-client-ui-conversation-files`,
which was already a clean, separate package there (of the two features this
repo carries, this one already followed the plugin pattern most closely).

## Design

- The package's default `.` export (`src/index.ts`) is a Host-safe no-op;
  the real `apply`/`inject` live under `./client` (`src/client/index.ts`,
  declared via this package's own `dsh.client` field) — same fix as
  `dsh-plugins-client-ui-workspace-files`, same reason: the Host Loader
  imports every `cordis.patch.yml` row's `.` export, and this package's real
  code transitively imports `dsh-client-ui-primitives`' CSS Modules. See
  `../bundle-workspace-git/README.md`.
- Registers a `'file'` entry into `dsh-client-ui-conversation`'s
  `conversation.view` slot — a genuine *pristine* `kind: 'list'` slot,
  already populated by `dsh-client-ui-chat` (`'chat'`) and
  `dsh-client-ui-trajectory` (`'trajectory'`). No upstream diff needed for
  this package to mount, unlike its sibling
  `dsh-plugins-client-ui-workspace-files`.
- Wire calls go through this repo's own `dsh-plugins-api-workspace-file-
  controller`/`dsh-plugins-api-workspace-git-controller` Typert namespaces,
  not the fork-extended `dsh-api-workspace-controller` client model the
  fork's own version called. `session.openWorkspacePath` (a pristine Host
  Remote method) still backs the external-open fallback, same as
  `dsh-plugins-client-ui-workspace-files`.
- `FileView`'s error handling discriminates by `RemoteError.code` via
  `remoteErrorOf` (`@deepseek-ai/dsh-typert-protocol`) instead of the fork's
  own `WorkspaceFileBrowseError` wrapper class — same touch as
  `dsh-plugins-client-ui-workspace-files`'s `FileViewer`.
- `FileEditor`/`FilePreview`/`SideBySideDiff` come from this repo's own
  `dsh-plugins-client-ui-file-editing`; `Button` and every other primitive
  stay on pristine `@deepseek-ai/dsh-client-ui-primitives` (only the three
  file-editing components moved out of that package, in the fork and here).
- `classify.ts` is a second, independent copy of the same extension→kind
  mapping `dsh-plugins-client-ui-workspace-files/classify.ts` carries —
  duplicated deliberately, not shared: cross-package imports of another
  plugin's symbols are forbidden by this codebase's own convention
  (`packages/client/AGENTS.md` in the vendored harness), and it's a small
  pure mapping, not a shared business concept.
- **Two locale seats, not one.** `t` (bound to the pristine `conversation`
  namespace, injected the normal way via the slot registration's own
  `locale: 'conversation'`) covers keys that already exist there — `copy`,
  `copied`, `markdown.footnotes`, `read.*` — genuinely pristine, since Chat
  messages already render Markdown/code blocks needing the same labels.
  `tFiles` (this package's own `conversation-files` namespace, registered
  and bound by hand in `apply.ts`, threaded through as a plain field on
  `FileViewInjected`) covers the 19 keys the fork added directly to
  `ui-conversation`'s dictionary (`view.file` — the tab's own label,
  mirroring `ui-chat`'s `view.chat` — plus 18 `files.*` keys). Unlike
  `dsh-plugins-client-ui-workspace-files`, where the *entire* `files.*` set
  was fork-only, here most of `FileView.tsx`'s `t()` calls stayed on the
  pristine namespace; only the fork-only subset moved to `tFiles`.

## The document seat, and the one toolbar over it

This package **declares** `conversation.file.document`
(`src/document-seat.ts`), the seat `dsh-plugins-client-ui-document-host`
relocates the upstream preview engine onto. A slot has exactly one declaring
entry, and that entry is this tab — so the contract lives here, and the host
registers into it by name and imports nothing from this package.

The seat answers `useTabInfo()` from the tab's own state. That is what makes
upstream's renderer bodies relocatable at all: they read everything from
that hook and nothing from owner props, so any seat that can answer it can
host them. Nothing registering into the seat is a normal state — the tab
then draws its own `FilePreview`, exactly as it did before the seat existed,
and that fallback is deliberate rather than vestigial.

**Controls: one component, two mount points.** View/Edit/Diff and the
autosave status readout live in `src/FileActions.tsx`. While the engine is
drawing, they register into its own header toolbar through
`sidebar.right.tab.document.actions`, so a file carries one row of controls
rather than the engine's toolbar beneath this tab's header — and this tab
then draws no header of its own, because the engine's already renders the
path.

They cannot live *only* there: that toolbar is the engine's body, mounted
only in View mode, so controls registered there and nowhere else would
vanish the moment Edit was pressed. So the tab draws the same component in
its own header whenever nothing has claimed it — in Edit and Diff, and in
any composition without the document host, where `slots.inject` never fires.

`FileView` keeps owning the state. The draft cache, the `writeFile` version
guard and the conflict notice stay here; it publishes a flat snapshot into a
per-session `FileModeStore` (`src/mode-store.ts`) that both mounts read, and
the store compares before notifying so publishing on every render does not
re-render the toolbar on every keystroke. Edit is offered for whatever
`isTextKind` admits — Markdown, ontology, delimited and RTF included — so a
text kind added later is not silently left out.

**There is no Save button.** Edits autosave: every keystroke (re)arms a
debounce (`FileView`'s `scheduleAutosave`, `AUTOSAVE_DEBOUNCE_MS`), and
`FileActions` shows the result — Saving…/Saved/Unsaved changes — in the
button's old place, `aria-live` so a screen reader hears the cycle the same
way it once heard a button's label change. Leaving Edit mode (View/Diff) or
Cmd/Ctrl+S in the editor flushes immediately instead of waiting the
debounce out. A version conflict or a write failure still surfaces as an
inline notice, same as before the button was removed — the conflict
notice's "Discard changes and reload", and the error notice's own "Retry",
which just re-runs the save.

## What still needs `conversationFileOpener`

This package renders the File tab and can be driven by anything that
already has access to `ConvViewOwnerProps.openView` from within the current
session's own render tree (e.g. a future chat-message file mention). What
it does **not** yet have is the cross-session trigger the sidebar's Files
tree needs (`ctx.get('conversationFileOpener')?.openFile(sessionId, path,
workspaceId)`, callable from anywhere, including a different session than
the one currently open) — that requires its own upstream diff to
`dsh-client-ui-conversation`'s `apply.ts` *and* its skeleton component
`ConversationSession.tsx`, materially bigger than
`workspaceFilesNode`'s Context-service addition. See `../../../ARCHITECTURE.md`'s
"File tab: a pristine slot, but a fork-only trigger" for the full
rationale, and Open items for its status (not yet drafted).

Until that lands, `dsh-plugins-client-ui-workspace-files`'s
`openFileInSession` always returns `false` and its own Files tree falls
back to its in-app preview modal instead of docking into this tab — by
that package's own design, not a stub.

## Known Limitations and Deferred Work

- No `conversationFileOpener` bridge yet (see above) — this tab can only be
  reached today by something with direct `ConvViewOwnerProps.openView`
  access from inside the current session's own render tree.
- No unit tests yet, consistent with the rest of this repo's packages at
  this stage (verified today by typecheck + build only).
