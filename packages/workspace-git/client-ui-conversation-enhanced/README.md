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
`dsh-plugins-client-ui-conversation-files`), even before that session's
first turn, when the pristine shell would otherwise still be showing its
centered Hero landing screen.

To get there:

- `src/FileOpenRegistry.ts` is new: a small per-session pending-request
  queue (`request`/`complete`/`hookFor`), the only mechanism available to
  hand a file-open request across the React boundary between the sidebar
  (any session) and the Session's own slots (only the currently mounted
  session) — no pristine API reaches a live per-session store instance from
  outside its own render tree (`ui-renderer`'s `SlotRegistry.resolveStore`
  is private, and `StoreHandle.create()` is documented "framework machinery
  and tests only" — calling it directly would create a disconnected
  instance, not the live one the mounted component uses). It also tracks a
  second, sticky fact per session: `hookForEverOpened` reports whether a
  file has ever been opened there, independent of the one-shot pending
  request — see "`conversationFileOpener` design notes" below for why.
- `src/service.ts` is new: the `ConversationFileOpener` service interface
  and its `declare module '@deepseek-ai/cordis'` Context merge, following
  this codebase's standing convention for optional cross-package services.
- `src/apply.ts` is a near-verbatim fork of the original's own `apply.ts` —
  same service construction (`UiConversation`, `InputHub`,
  `ComposerBlockRegistry`, `ComposerSubmissionPolicy`), same four slot
  registrations, same locale dictionaries, same `ConversationController`/
  `todoDockEntry`/`queueDockEntry` plugins, all imported unchanged from the
  original package's own `./src/*` export. The edits: `registerConversationRoot`,
  `registerConversationSession`, and `registerConversationHeader` each gain
  an `everOpenedFile` hook (`EnhancedConversationInjected`/
  `EnhancedConversationSessionInjected`/`EnhancedConversationSessionHeaderInjected`,
  each widening its pristine counterpart), `registerConversationSession`
  additionally gains a `pendingFileOpen` hook and `completePendingFileOpen`
  callback, all three register this package's own forked components instead
  of the pristine ones, and one `ctx.provide('conversationFileOpener', ...)`
  call is added at the end.
- `src/ConversationRoot.tsx` is a fork of the original's own
  `skeleton/ConversationRoot.tsx` — same body (Hero chrome, composer
  positioning, the composer chain, width handles), with `hero` (and
  therefore `phase`) also staying `false` once `everOpenedFile` is true.
- `src/ConversationSession.tsx` is a fork of the original's own
  `skeleton/ConversationSession.tsx` — both its exports.
  `ConversationSession` gains one effect that drains a pending
  `conversationFileOpener` request into this Session's own
  `actions.openView('file', focus)` (the same one-shot
  `viewRequest`/`completeViewRequest` mechanism the File tab already reads
  — see `dsh-plugins-client-ui-conversation-files/src/FileView.tsx`'s
  `OpenFileFocus`), and both it and `ConversationSessionHeader` widen the
  pristine `session.blank && conversationPhase(...) === 'blank'` gate (which
  hides the header tabs and the view body alike) with the same
  `!everOpenedFile` escape hatch `ConversationRoot` uses for `hero`.
  `InputBar` is reused unchanged.
- `src/ConversationRoot.module.css` is a local copy of the original's CSS
  Module, not a cross-package import: the CSS-modules-inline transform
  resolves only relative paths (the same finding
  `../client-ui-workspace-enhanced` made for `WorkspaceBrowser.module.css`).
  Both forked skeleton files share this one copy.

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
- A session that has never had a first turn is NOT refused: `request()`
  also marks the session's `everOpened` bit (sticky — set once, never
  cleared), which `ConversationRoot`'s `hero`, `ConversationSessionHeader`'s
  `hideChrome`, and `ConversationSession`'s own blank early-return all read
  alongside the pristine `session.blank && conversationPhase(...) ===
  'blank'` check. Without this, opening a file from the sidebar on a brand
  new conversation would queue correctly but drain into a view the pristine
  Hero gate keeps hidden — the bug this whole `everOpened` mechanism exists
  to close. The bit deliberately never reverts to `false`: once a session
  has shown a file, it keeps the ordinary (non-Hero) header/tabs/composer
  layout for the rest of its life in this registry, the same way an actual
  first turn would have.
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

`typecheck` + `build` are clean (the closure-factory bundle, `lib/client.js`
— the whole conversation shell, including the lexical composer editor, ends
up in this one package now that it owns the registration — grew from the
`ConversationSession`-only fork's 622.67 kB to 667.57 kB before gzip once
`ConversationRoot`/`ConversationSessionHeader` joined it). A real `dsh
--profile web-app --dump-config` against `dsh-plugins-bundle-workspace-git`
shows `ui-conversation` disabled and `conversation-enhanced` inserted with
no composition errors, and a real `dsh web` boot serves a working page whose
combo-script manifest lists this package's `client.js` and **omits**
`@deepseek-ai/dsh-client-ui-conversation/client.js` — confirming the
disable took effect at the wire level. See `../../../ARCHITECTURE.md`'s
"Confirmed working" section for exactly what was and wasn't checked
(genuine browser-side DOM rendering of the `everOpenedFile` escape hatch —
opening a file on a brand-new session and seeing the same header/tabs/
composer layout an engaged session gets — is the one behavior this write-up
describes but a future verification pass still needs to confirm against a
live boot; the byte-for-byte wire-format/CSS-injection-marker counts the
`ConversationSession`-only fork was once checked against are stale after
this widening and are not restated here).

**Do not read this section as confirmation that mouse-wheel scrolling is
fixed app-wide** — nobody has re-run the live browser repro since either fix
below landed; both are `typecheck`/`build`-clean and bundle-grep-confirmed,
not DOM-confirmed.

- `FileOpenRegistry.hookFor`/`hookForEverOpened` memoization (per-session
  hook objects, not a fresh object literal per `inject()` call) is a real,
  independently worth-keeping correctness fix — it matches vendor's own
  `ComposerBlockRegistry.storeFor` contract and was confirmed by bisection to
  restore scrolling when this package's whole conversation fork is disabled.
  It was NOT independently confirmed against a live boot with this package
  active, and turned out not to be the actual cause of a reported
  app-wide mouse-wheel scrolling regression that reproduced with this fix
  already in place — see the next item.
- The actual cause: `../../../tsdown.client-plugin-preset.ts`'s
  `styleInjectionModule` derived its CSS `<style>`-tag id from a source
  file's basename alone (`${id}/${basename}`), which collides whenever a
  fork and the vendor package it forks each own a same-named CSS Module —
  exactly this package's own `ConversationRoot.module.css` vs.
  `dsh-client-ui-conversation`'s own file of the same name. This package's
  `apply.ts` used to statically import vendor's whole `apply.ts` (for its
  fallback path only, but a static top-level import evaluates unconditionally),
  which evaluated vendor's `ConversationRoot.tsx` and injected vendor's CSS
  under that tag id before this package's own CSS Module ever got a chance
  to — the `document.querySelector(...) === null` injection guard then saw
  the tag already present and silently skipped this package's own stylesheet.
  The DOM rendered with this package's own scoped classnames, but the only
  rules ever inserted under that tag were vendor's, scoped to different
  classnames — so `.scrollBody`'s `overflow-y: auto` and `.root`'s
  `overflow: hidden` never took effect anywhere in the conversation column
  (Chat, Trajectory, and File alike, since all three mount inside this one
  forked skeleton). Fixed two ways: the tag id now incorporates a hash of the
  full resolved source path, not just the basename (unconditional fix, in the
  shared preset, covers every current and future same-named-CSS-Module fork);
  and the `pristineApply` import in this package's own `apply.ts` (and
  `../client-ui-workspace-enhanced`'s, which has the identical pattern with
  `WorkspaceBrowser.module.css`) is now a dynamic `import()` invoked only
  inside the fallback branch that actually needs it, so the always-on
  eager-evaluation trigger is gone even though the tag-id fix alone is
  sufficient.
- **Sharp edge for future plugins:** any fork that both owns a CSS Module and
  imports (statically or dynamically) the vendor package it forks — for its
  own fallback path or otherwise — shares a build with vendor's same-named
  CSS Module. The tag-id fix makes that safe by construction now, but a
  *content* collision (two different `.root` rules both racing to the DOM)
  is a distinct question the tag-id fix does not answer; keep forked CSS
  Modules feature-complete forks, not partial overrides that rely on
  vendor's rules cascading underneath.

**Test-only finding, not part of this package:** verifying against a
`web-app`-derived profile once hit `dsh-plugins-bundle-workspace-git`'s own
`workspace-registry-seam` row duplicate-mounting `@deepseek-ai/dsh-workspace`
over `web-app`'s own mount — unrelated to `conversationFileOpener`, and
since fixed by dropping that row entirely; see
`../bundle-workspace-git/README.md`.
