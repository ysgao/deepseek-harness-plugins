# dsh-plugins-client-ui-conversation-files

The File tab in the conversation view: in-app file preview, edit, and
side-by-side git diff for a session's opened workspace paths — ported from
`yga/deepseek-harness`'s `@deepseek-ai/dsh-client-ui-conversation-files`,
which was already a clean, separate package there (of the two features this
repo carries, this one already followed the plugin pattern most closely).

## Design

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
