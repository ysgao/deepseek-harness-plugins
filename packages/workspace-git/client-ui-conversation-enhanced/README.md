# dsh-plugins-client-ui-conversation-enhanced

An out-of-tree **replacement** for `dsh-client-ui-conversation`'s own
conversation-shell registration (`conversation`, `conversation.session`,
`conversation.session.header`, `conversation.composer.bar`) — not a patch to
that package. `dsh-plugins-bundle-workspace-git`'s `cordis.patch.yml`
disables the original row and inserts this one in its place. See
`../../../ARCHITECTURE.md`'s "Why replace the plugin instead of patching
it" and "File tab: a pristine slot, but a fork-only trigger" for the full
rationale.

## What changes, what doesn't

The only behavior difference from the original `dsh-client-ui-conversation`:
this package provides the `conversationFileOpener` optional Context
service (`ctx.get('conversationFileOpener')`) — the cross-session bridge
that lets `dsh-plugins-client-ui-workspace-files`'s sidebar Files tree dock
a file into a session's File tab (View/Diff/Edit, from
`dsh-plugins-client-ui-conversation-files`) instead of always falling back
to its own in-app preview modal.

To get there:

- `src/FileOpenRegistry.ts` is new: a small per-session pending-request
  queue (`request`/`complete`/`hookFor`), the only mechanism available to
  hand a file-open request across the React boundary between the sidebar
  (any session) and the Session body slot (only the currently mounted
  session) — no pristine API reaches a live per-session store instance from
  outside its own render tree (`ui-renderer`'s `SlotRegistry.resolveStore`
  is private, and `StoreHandle.create()` is documented "framework machinery
  and tests only" — calling it directly would create a disconnected
  instance, not the live one the mounted component uses).
- `src/service.ts` is new: the `ConversationFileOpener` service interface
  and its `declare module '@deepseek-ai/cordis'` Context merge, following
  this codebase's standing convention for optional cross-package services.
- `src/apply.ts` is a near-verbatim fork of the original's own `apply.ts` —
  same service construction (`UiConversation`, `InputHub`,
  `ComposerBlockRegistry`, `ComposerSubmissionPolicy`), same four slot
  registrations, same locale dictionaries, same `ConversationController`/
  `todoDockEntry`/`queueDockEntry` plugins, all imported unchanged from the
  original package's own `./src/*` export. The only edits:
  `registerConversationSession`'s `inject()` factory gains a
  `pendingFileOpen` hook and `completePendingFileOpen` callback
  (`EnhancedConversationSessionInjected`, widening the pristine
  `ConversationSessionInjected`), its registered component is this
  package's own forked `ConversationSession` instead of the pristine one,
  and one `ctx.provide('conversationFileOpener', ...)` call is added at the
  end.
- `src/ConversationSession.tsx` is a fork of the original's own
  `skeleton/ConversationSession.tsx` `ConversationSession` export — same
  body, plus one effect that drains a pending `conversationFileOpener`
  request into this Session's own `actions.openView('file', focus)` (the
  same one-shot `viewRequest`/`completeViewRequest` mechanism the File tab
  already reads — see `dsh-plugins-client-ui-conversation-files/src/
  FileView.tsx`'s `OpenFileFocus`). `ConversationSessionHeader` (the
  pristine file's other export, unaffected by file-opening) is reused
  unchanged from `@deepseek-ai/dsh-client-ui-conversation/src/client/
  skeleton/ConversationSession.tsx`; so are `ConversationRoot` and
  `InputBar`.
- `src/ConversationRoot.module.css` is a local copy of the original's CSS
  Module, not a cross-package import: the CSS-modules-inline transform
  resolves only relative paths (the same finding
  `../client-ui-workspace-enhanced` made for `WorkspaceBrowser.module.css`).

## Why inlining the original package's internals is safe here

The closure-factory bundle (`tsdown.config.ts`) passes `extraInlineSafe:
/^@deepseek-ai\/dsh-client-ui-conversation\/src\//` to
`../../../tsdown.client-plugin-preset.ts`'s purity gate, which otherwise
forbids inlining another package's `@deepseek-ai/*` internals (the general
case that protects against two independently-loaded bundles each carrying
their own copy of shared runtime state). That protection doesn't apply
here: this package's `cordis.patch.yml` row **disables** the original
`dsh-client-ui-conversation` browser plugin wherever this one is installed,
so there is never a second, live instance of its state (the conversation
store, `UiConversation`, the input hub) running alongside this one to
duplicate identity against.

## `conversationFileOpener` design notes

- `openFile(sessionId, path, workspaceId)` returns `false` when `sessionId`
  resolves no session binding, or when no `conversation.view` entry
  registers the `file` id (this package installed without
  `dsh-plugins-client-ui-conversation-files`). Both checks fail loud toward
  the caller's own documented fallback (`FilesNode`'s in-app preview modal)
  rather than silently queuing a request nothing will ever drain.
- The queue is keyed by `sessionId`, not restricted to "the current
  session" — `dsh-plugins-client-ui-workspace-files`'s own `FilesNode` only
  ever calls it with `currentSessionId` today (its own choice, not this
  service's constraint), but a future caller addressing a background
  session is a request this service can already queue correctly: it drains
  the moment that session's own `ConversationSession` next mounts.
- `'file'` (the target view id) is hardcoded at the one point the drain
  effect translates a pending request into `actions.openView(...)` — this
  package doesn't know View ids in general, only that
  `dsh-plugins-client-ui-conversation-files` is the one package that
  interprets this focus payload shape.

## Verification

`typecheck` + `build` are clean; the closure-factory bundle (`lib/client.js`,
622.67 kB before gzip — the whole conversation shell, including the lexical
composer editor, ends up in this one package now that it owns the
registration) is byte-verified against the expected
`window.__ModuleLoader__.load({id, factory})` wire format, exporting
`apply`, `inject`, `ConversationSession`, with 11 CSS injection markers (this
package's own `ConversationRoot.module.css` plus the unchanged, inlined
`InputBar`/queue/settings skeleton CSS Modules). A real `dsh --profile
web-app --dump-config` against `dsh-plugins-bundle-workspace-git` shows
`ui-conversation` disabled and `conversation-enhanced` inserted with no
composition errors. A real `dsh web` boot serves a working page whose
combo-script manifest lists this package's `client.js` and **omits**
`@deepseek-ai/dsh-client-ui-conversation/client.js` — confirming the
disable took effect at the wire level; the combo script itself fetches
`HTTP 200` with this package's module id present and every expected
`window.__ModuleLoader__.load({...})` call intact. See
`../../../ARCHITECTURE.md`'s "Confirmed working" section for exactly what
was and wasn't checked (genuine browser-side DOM rendering is still
unverified, same caveat as every other Client package here).

**Test-only finding, not part of this package:** verifying against a
`web-app`-derived profile once hit `dsh-plugins-bundle-workspace-git`'s own
`workspace-registry-seam` row duplicate-mounting `@deepseek-ai/dsh-workspace`
over `web-app`'s own mount — unrelated to `conversationFileOpener`, and
since fixed by dropping that row entirely; see
`../bundle-workspace-git/README.md`.
