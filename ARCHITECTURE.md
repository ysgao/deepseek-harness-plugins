# Architecture

This repo hosts two independent, **out-of-tree** `dsh` plugin bundles that
reproduce features from `yga/deepseek-harness` (a fork of
`deepseek-ai/deepseek-harness`) without forking or editing the harness
itself:

1. **`packages/workspace-git/`** — the File manager sidebar (file tree,
   preview, in-app edit, side-by-side git diff) and its git status/commit
   /fetch/pull-rebase/push actions.
2. **`packages/anthropic-subscription/`** — Anthropic subscription
   authorization, in the CLI and in the Models settings UI.

Neither bundle patches, copies, or forks any file under
`packages/_vendor/deepseek-harness/`. Every package here either *depends
on* published seams (`ctx.authorization`, Typert-registered Host
controllers auto-discovered by `dsh-typert-loader`, `dsh-cmdline`'s
multi-plugin argument parsing, and the `SlotMap` extension points
`ui-conversation` and `ui-settings-models` already declare), or — where no
such seam exists yet — *replaces* one existing plugin registration
wholesale with an enhanced out-of-tree one, using `cordis.patch.yml`'s own
`disabled: true` operation to turn the original off first (see
`dsh-plugins-client-ui-workspace-enhanced` below and "Why replace the
plugin instead of patching it"). Either way, installation is `dsh plugin
--profile <name> add <package>` (see
`packages/_vendor/deepseek-harness/packages/bundle/README.md`).

## Why this repo exists

`yga/deepseek-harness` implemented both features by editing upstream
packages directly (`api/workspace-controller`, `client/ui-workspace`,
`client/ui-primitives`, `client/ui-conversation`, `api/settings-controller`,
`client/ui-settings-models`, `bundle/headless`) instead of registering
against the seams those packages already expose. `git diff
upstream/master...master` there shows 126 modified upstream files against
102 new ones — every one of those 126 is a future upstream-merge conflict.
This repo carries the same functionality as new, additive packages instead,
so the fork can go back to tracking upstream cleanly. `yga/deepseek-harness`
itself is left untouched as a reference/backup.

## Dependency source

`@deepseek-ai/dsh-*` packages are not published to npm (only
`@deepseek-ai/cordis` is). `packages/_vendor/deepseek-harness/` is a git
submodule pinned to a `deepseek-ai/deepseek-harness` commit;
`pnpm-workspace.yaml` folds its `packages/*/*`, `vendor/*` (Cordis,
cosmokit, schemastery, …), `apps/*`, and `native/landlock-run` into this
workspace so `workspace:^` dependencies resolve against real upstream
sources. Bumping the pin is a plain `git submodule update --remote` +
`pnpm install`, reviewed like any other dependency bump.

**Nested under `packages/`, not a sibling `vendor/` directory.** This one
is load-bearing, not cosmetic: `dsh-typert-generator`'s workspace-mode
analysis only recognizes `@deepseek-ai/dsh-typert-protocol` — the package
`Remote`/`TypertRemoteService`/`RemoteScope` decorators must resolve back
to — when that package's real (symlink-resolved) path lives under
`<workspaceRoot>/packages/`, a `deepseek-harness`-internal-layout
assumption baked into `loadRegistrations()`. A sibling `vendor/` mount
makes every `@Remote` method in this repo's own controllers silently
invisible to the generator (no error — `pkg.invocations` just comes back
empty and the build fails on the `./remote` export mismatch it validates
afterward). Two more things had to follow from this once packages were
nested correctly: `tsconfig.host.json` must **directly** (not only
transitively, via some other package's own references) reference
`.../packages/typert/protocol`, since `loadRegistrations()` only walks the
aggregate config's own top-level `projectReferences`; and
`tsconfig.base.json` needs a `paths` entry pointing
`@deepseek-ai/dsh-typert-protocol` at that package's `src/index.ts` (not
its built `.d.ts` via `node_modules`), because the generator's own
`ts.createProgram()` call builds one flat program from
`tsconfig.host.json`'s options — bypassing project-reference declaration
redirects entirely — so a consumer resolving the package via
`node_modules` and the generator's own registration of that same package
resolving via source produce two non-identical `ts.Symbol`s for
`TypertRemoteService`, and the heritage-clause check that binds a `@Remote`
method to its owning service crashes trying to reconcile them.

One more gotcha, unrelated to the layout fix above: **declare `zod` as a
real dependency in every package that ships a `./typert` export.**
`dsh-typert-loader` validates each generated schema structurally
(`'_zod' in schema && typeof schema.parse === 'function'`) rather than by
`instanceof`, so it doesn't care which copy of `zod` produced it — but a
package that never declares `zod` at all still gets *something* back from
a bare `import { z } from 'zod'`, silently resolving to whatever `zod`
Node's module resolution finds first outside the workspace (an ambient
global install, in one case) — a v3 copy with no `_zod` property, which
`dsh-typert-loader` correctly rejects at boot with "parameter codec is not
backed by a zod v4 schema" and no hint about *why*. Declaring `"zod":
"^4.4.3"` (matching `dsh-typert-protocol`'s own pin) fixes it outright.

One more gotcha, this time Client-side: **a Client-face package's default
(`.`) export must be Host-safe — no transitive CSS Modules import.** The
Host Loader imports every `cordis.patch.yml` row's `.` export during
composition, even for a row whose package only declares a `dsh.client`
face; a plain Node ESM import throws `ERR_UNKNOWN_FILE_EXTENSION` on a
`.css` import (only a browser bundle's CSS-modules-inline transform
resolves those). `dsh-plugins-client-ui-workspace-files` and
`dsh-plugins-client-ui-conversation-files` both originally put their real
`apply`/`inject` on `.`, and a real boot against
`dsh-plugins-bundle-workspace-git` crashed immediately importing
`dsh-client-ui-primitives`' `StateDot.module.css` transitively. Both now
split into a Host-safe no-op at `.` and the real code under `./client`
(declared via `dsh.client` in `package.json`, resolved only by the
browser-side loader, `packages/client/web`) — the same two-entry-point
shape pristine `dsh-client-ui-workspace` and `yga/deepseek-harness`'s own
`ui-conversation-files` package already use, whose purpose is now clear.

One more Client-side gotcha, once `./client` genuinely needed to be a real
browser bundle: **the vendored `clientConfig()`/`clientBundle()` tsdown
preset (`packages/client/tsdown.client.ts`) can't build an out-of-tree
package.** It locates a package's manifest by globbing
`packages/*​/*​/package.json` under the vendored submodule's own hardcoded
root (`workspaceManifest()`), with no override — a package under this
repo's own `packages/` is invisible to it. `tsdown.client-plugin-preset.ts`
(repo root) reproduces the same wire contract instead — the closure-factory
banner/footer (`window.__ModuleLoader__.load({id, factory})`), the CSS
Modules inline transform, and the cross-plugin import purity gate — reusing
what's genuinely exported for reuse (`requestedExternals`, a pure function;
`PLATFORM_MODULES`/`PRELOADED_CLIENT_EXTERNALS` via `dsh-client-web`'s own
declared `./src/*` export) rather than the internals. Its `extraInlineSafe`
option exists for exactly one case: `dsh-plugins-client-ui-workspace-
enhanced` imports another package's internals as real values (see below),
which the purity gate would otherwise reject as a forbidden cross-plugin
import.

Confirmed working fully end to end (`dsh plugin --profile <name> add`
against a real, if temporary, `$DSH_HOME`, then a real boot):
`dsh-plugins-api-authorization-controller` builds `lib/typert.host.js` +
`lib/typert.remote-client.js` with all five `@Remote` methods correctly
modeled, installs via `dsh plugin --profile acp add
dsh-plugins-bundle-anthropic-subscription`, and the `acp` profile boots
clean (exit 0, `typert-loader` registers the `authorization` namespace, no
errors). `dsh-plugins-cli-login-app` installs the same way into its own
profile and `dsh --profile anthropic --help` prints its own help text
through `dsh-cmdline`, confirming the standalone-profile design in
"CLI login: why its own profile" below actually avoids the task-positional
race it exists to avoid. One more precondition both needed: **no shipped
bundle mounts `@deepseek-ai/dsh-authorization` itself** in a pristine
`deepseek-ai/deepseek-harness` checkout — `yga/deepseek-harness`'s fork
added that row to its own `base` bundle, which is why the fork never had
to think about it. Both bundles here mount it themselves
(`id: authorization-seam`) so they're self-sufficient regardless of what
profile they land in.

## Package inventory

### `packages/workspace-git/` — File manager + git

| Package | Seam it registers into | Ported from (`yga/deepseek-harness`) |
|---|---|---|
| `dsh-plugins-api-workspace-git-controller` | New Typert Host controller (auto-discovered by `dsh-typert-loader`; no edit to `api/workspace-controller`) | `packages/api/workspace-controller/src/workspace-git.ts` (status, commit-all, fetch, pull --rebase, push, discard-all) + `tests/workspace-git.host.spec.ts` |
| `dsh-plugins-api-workspace-file-controller` | New Typert Host controller | `packages/api/workspace-controller/src/{files,file-commands}.ts` (list/read/write/create/delete/diff) + their host specs |
| `dsh-plugins-client-ui-file-editing` | Standalone components (no shared-package dependency) | `packages/client/ui-primitives/src/{FileEditor,FilePreview,SideBySideDiff}.tsx` + `.module.css` + `codemirror/theme.ts` + `useSplitRatio.ts` + tests — moved out of the shared `ui-primitives` package, which every other UI plugin depends on |
| `dsh-plugins-client-ui-workspace-files` | **Confirmed working** — the sidebar Files tree and the optional `workspaceFilesNode` Context service it provides; typecheck + build + a real closure-factory bundle, confirmed present in a live `dsh web` combo-script manifest (see "Confirmed working" below) | `packages/client/ui-workspace/src/client/files/{FilesNode,FileViewer,classify}.tsx` — near-verbatim; also 7 icons the fork added directly to `ui-primitives` (`icons.tsx`, kept local) |
| `dsh-plugins-client-ui-workspace-enhanced` | **Confirmed working** — replaces `dsh-client-ui-workspace`'s own `sidebar.workspaces`/`conversation.hero.workspace` registrations wholesale (not a patch to that package); the only behavior change is rendering `workspaceFilesNode`'s `Component` as a Files sibling row. See "Why replace the plugin instead of patching it" | New package; forks only `rows/WorkspaceBrowser.tsx` from `packages/client/ui-workspace/src/client/`, near-verbatim plus the Files row; everything else (`WorkspacePicker`, `navigation.ts`, `stores.ts`, `tree.ts`, `locales.ts`, `Rows.tsx`) is imported unchanged from the original package's own `./src/*` export, not duplicated |
| `dsh-plugins-client-ui-conversation-files` | **Confirmed working** — registers into the *pristine* `conversation.view` list slot (`dsh-client-ui-conversation`), no upstream diff needed for the tab itself. Populated through `conversationFileOpener`, provided by `dsh-plugins-client-ui-conversation-enhanced` below | `packages/client/ui-conversation-files/**` (already a clean, separate package in the fork — ported near-verbatim, repointed at `dsh-plugins-client-ui-file-editing`/this repo's own controllers instead of `ui-primitives`/the fork-extended `dsh-api-workspace-controller` client) |
| `dsh-plugins-client-ui-conversation-enhanced` | **Confirmed working** — replaces `dsh-client-ui-conversation`'s own conversation-shell registration wholesale (not a patch to that package); the only behavior change is providing the `conversationFileOpener` cross-session bridge. See "File tab: a pristine slot, but a fork-only trigger" | New package; forks only `skeleton/ConversationSession.tsx`'s `ConversationSession` export from `packages/client/ui-conversation/src/client/`, near-verbatim plus a `pendingFileOpen` drain effect; everything else (`ConversationRoot`, `ConversationSessionHeader`, `InputBar`, the input hub, queue/settings docks, stores, locales) is imported unchanged from the original package's own `./src/*` export, not duplicated |
| `dsh-plugins-bundle-workspace-git` | **Confirmed working** — installs via `dsh plugin --profile <name> add`; a real `dsh web` server boots and serves a working page whose combo-script manifest lists exactly the expected rows (all Client packages here present, both `@deepseek-ai/dsh-client-ui-workspace/client.js` and `@deepseek-ai/dsh-client-ui-conversation/client.js` absent — both disables took effect). See "Confirmed working" below for exactly what that checked and didn't | New — replaces the direct edits to `packages/bundle/base/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml`; mounts `@deepseek-ai/dsh-workspace` itself (only `web-app` mounts it by default, mirroring `authorization-seam` below); disables and replaces both the `ui-workspace` and `ui-conversation` rows (only present once `@deepseek-ai/dsh-web-app`'s own bundle has already inserted them — install order matters, see below) |

### `packages/anthropic-subscription/` — Anthropic subscription authorization

| Package | Status | Seam it registers into | Ported from (`yga/deepseek-harness`) |
|---|---|---|---|
| `dsh-plugins-api-authorization-controller` | **Confirmed working** — builds, installs, boots clean | New Typert Host controller, mounted as an independent top-level plugin — **not** nested inside `SettingsController`'s constructor the way the fork mounted it. That nesting turned out to be an organizational choice, not a requirement: the class only ever needed `ctx`, and `dsh-typert-loader` auto-discovers any top-level Loader entry that exports `./typert`. No edit to `api/settings-controller`. | `packages/api/settings-controller/src/authorization.ts` (271 lines) + `types.ts`'s authorization slice. Adapted to the current (newer-pinned) `dsh-typert-protocol` API: `TypertRemoteFailure({code,message,details})` was renamed to `RemoteError(code, message, details)`, keyed by a merge-extensible `RemoteErrorDetailsMap` a package declares its own codes into (`declare module '@deepseek-ai/dsh-typert-protocol' { interface RemoteErrorDetailsMap {...} }`) — this repo declares `authorization/not-found`, `authorization/in-flight`, `authorization/rejected`, `authorization/prompt-not-found`. |
| `dsh-plugins-cli-login-app` | **Confirmed working** — builds, installs, boots clean, `--help` prints correctly | Its own standalone `dsh --profile <name>` application, **not** a `login` subcommand added to `@deepseek-ai/dsh-headless`. See "CLI login: why its own profile" below. | `packages/bundle/headless/src/index.ts`'s `login` mode (`buildTerminalInteraction`/`runLogin`) — the fork wove it into `headless-runner`'s shared `Config`/`apply()` instead of giving it independent argument grammar. |
| `dsh-plugins-client-ui-settings-anthropic-subscription` | **Stub — upstream-PR candidate, not buildable out-of-tree** | None available. See "Settings UI: why it can't be a pure plugin" below. | `packages/client/ui-settings-models/src/client/{AuthorizationPanel.tsx,authorization-runtime.ts}` + the ~140-line diff across `ProviderEditor.tsx`/`ModelsSection.tsx`/`client/index.ts` that wires them in. |
| `dsh-plugins-bundle-anthropic-subscription` | **Confirmed working** — `dsh plugin --profile acp add dsh-plugins-bundle-anthropic-subscription` reconciles into `dsh.profile.bundles`, and `dsh --profile acp` boots to a clean exit with the `authorization` Typert namespace registered | `cordis.patch.yml` bundle for `web`/`headless`/`acp`/`sdk` (`dsh-base`-derived) profiles — inserts `@deepseek-ai/dsh-authorization` itself (absent from every shipped bundle upstream — see below) plus `authorization-controller` | New |

No new package needed for the OAuth flow itself: `@deepseek-ai/dsh-llm-pi-ai`
(already upstream, untouched by the fork beyond its README) unconditionally
calls `ctx.inject(['authorization'], authorized => registerPiAiFlows(authorized, auth))`
in its own `apply()` — the moment `ctx.authorization` exists in a
composition, it registers one dormant `ctx.authorization.registerFlow()`
per installed `@earendil-works/pi-ai` catalog provider, Anthropic included.
`dsh-llm-pi-ai` is already mounted (dormant) in `bundle/base`. What the fork
actually built beyond that was purely surface: an RPC controller, a CLI
command, and a UI panel exposing that already-registered flow.

#### CLI login: why its own profile

`dsh --profile headless login llm-pi-ai/anthropic` (the fork's UX) can't be
reproduced as an out-of-tree `login` subcommand *added to* `dsh-headless`.
`dsh-cmdline`'s own README documents that any number of plugins can read
the launcher's argument line and each parses independently — but
`@deepseek-ai/dsh-headless/startup` declares a variadic `[task...]`
positional with no grammar that rejects `login llm-pi-ai/anthropic`, so a
second plugin's `login` command would fire **alongside** it: a real
headless task run using the credential key as its literal prompt, racing
the actual login flow. `dsh-plugins-cli-login-app` sidesteps this by being
its own profile with no task-positional parser mounted at all —
`dsh --profile anthropic llm-pi-ai/anthropic` (no `login` verb needed, since
there's nothing else to disambiguate from). Confirmed: `dsh-cmdline`'s own
README explicitly supports this ("Apps built outside this repository
behave the same way").

#### Settings UI: why it can't be a pure plugin

`ui-settings-models` declares exactly two extension slots
(`settings.models.provider-card`, `settings.models.footer` — see its own
`slot-contract.ts`), and neither reaches where sign-in needs to render.
Reading the fork's actual diff: `AuthorizationPanel` is imported and
rendered *directly inside* `ProviderEditor.tsx`, right after the API-key
input field — `ProviderEditor`'s `authorization?: IAuthorization` prop is
already fully generic (its own doc: *"a route the catalog does not
register a flow for... correctly shows none"*), so this reads as
intentional, well-designed, upstream-worthy functionality that was simply
never split into its own capability seam. Forcing it out-of-tree would mean
either (a) a small core edit anyway, or (b) forking `ProviderEditor.tsx`'s
~560 lines wholesale into this repo to splice in one panel — reintroducing
exactly the drift problem this repo exists to avoid, one file later.
Recommendation: propose the four-file diff (`AuthorizationPanel.tsx`,
`authorization-runtime.ts`, the `ProviderEditor`/`ModelsSection`/`index.ts`
wiring) as a small, self-contained PR to `deepseek-ai/deepseek-harness`
directly, generalized (it already is) rather than Anthropic-specific.

#### Files tree: why an optional service, not a slot

`ui-workspace` has no child slot in `WorkspaceBrowser`'s row list for a
Files entry (the same finding as the Settings panel above: the fork's mount
point was a direct edit, not an existing extension point) — see the user's
own design direction: keep the current layout, the Files tree as a sibling
row under each real Workspace group, the selected Workspace's own directory
as its implicit root, no extra click; a right-side pane was offered only as
a fallback, not the target design. A brand-new `SlotMap` child key would
work but is more machinery than the problem needs: `dsh-client-ui-workspace`
just needs one optional UI decoration from a package that may or may not be
composed in, and `packages/AGENTS.md` already names the pattern for that —
"Optional services use `ctx.get(name)`." (`dsh-client-ui-conversation`'s
`conversationFileOpener` is the same shape of seam and shows the fork itself
independently reached the same conclusion; this repo now provides it via
`dsh-plugins-client-ui-conversation-enhanced` — see "File tab: a pristine
slot, but a fork-only trigger" below.)
`dsh-plugins-client-ui-workspace-files` follows the documented convention
directly: `workspaceFilesNode: WorkspaceFilesNodeService | undefined`,
resolved once via `ctx.get('workspaceFilesNode')`.

#### Why replace the plugin instead of patching it

The service exists; something still has to *resolve* it and render its
`Component` where `FilesNode` sat in the fork, and `dsh-client-ui-workspace`
itself doesn't do that. Two ways to get there were considered:

1. **A small source patch** to `ui-workspace/src/client/{contract/slots.ts,
   index.ts, rows/WorkspaceBrowser.tsx}` — drafted and verified as
   `upstream-patches/0001-workspace-files-node-optional-service.patch`
   (`git apply --check` clean against the pinned commit, a forced `tsc -b`
   rebuild with it applied passes). Applying it locally would mean either
   forking `deepseek-ai/deepseek-harness` to hold the patched commit (a real
   repo to maintain, a submodule re-pin, and every future pin bump needs the
   patch rebased forward) or hand-patching the pinned submodule's working
   tree outside of git history (fragile — nothing forces a fresh clone to
   reapply it, and a dirty submodule risks an accidental bad commit).
2. **Replace the plugin.** `cordis.patch.yml` already has `{id, disabled:
   true}` alongside `{insert: [...]}` — ordinary composition operations,
   not a new mechanism. Disable the row `@deepseek-ai/dsh-web-app`'s own
   bundle inserts for `dsh-client-ui-workspace`, insert
   `dsh-plugins-client-ui-workspace-enhanced` in its place, and let the
   replacement register the exact same slots the original did, plus the one
   new row.

Option 2 is what this repo does, on direct instruction: "everything is a
plugin" applies to the seam-providing side too, not just the feature side —
unplug the original, plug in an enhanced one, entirely through the same
`dsh plugin add` composition mechanism every other package here already
uses. No fork of `deepseek-ai/deepseek-harness`, no submodule pin tied to
a patch branch, no vendored file touched even transiently. The replacement
package reuses everything it isn't changing: `dsh-client-ui-workspace`
declares `"./src/*": "./src/*"` in its own `exports` map (a convention this
whole codebase uses), so `WorkspacePicker`, `UiWorkspaceService`,
`createWorkspaceViewStore`, `tree.ts`'s group-deriving logic, and the
`workspace` locale dictionaries are all imported as real values from that
path — not copied. Only `rows/WorkspaceBrowser.tsx` (the one file that
actually changes) is forked, with import paths repointed the same way
`FilesNode.tsx` was in Task 18.

`upstream-patches/0001-workspace-files-node-optional-service.patch` stays
in the repo as a smaller, cleaner alternative some day, per "prepare it,
don't submit it" — genuinely proposing the small addition to
`dsh-client-ui-workspace` remains worthwhile even though this repo doesn't
depend on it landing.

`dsh-plugins-client-ui-conversation-enhanced` applies the identical
pattern to `dsh-client-ui-conversation`'s own conversation-shell
registration, for the `conversationFileOpener` bridge — see "File tab: a
pristine slot, but a fork-only trigger" below. No separate upstream-patch
alternative was drafted for that one: unlike `workspaceFilesNode`, the fork's
own diff there touches a skeleton component's render body
(`ConversationSession.tsx`), not just an added Context service, so a small
source patch wouldn't be meaningfully smaller than the replacement package.

#### Confirmed working: `dsh-plugins-client-ui-workspace-enhanced`

Verified this repo's disable+insert composition against a real, if
temporary, `$DSH_HOME`, with `@deepseek-ai/dsh-web-app`'s own bundle
installed first (its `cordis.patch.yml` is what inserts the `ui-workspace`
row this bundle disables — order matters, see "Bundle install order" in
Open items) and `apps/web`'s Vite frontend built as part of `pnpm run build`:

- `dsh --profile <name> --dump-config` shows the `ui-workspace` row with
  `disabled: true`, `dsh-plugins-client-ui-workspace-enhanced` inserted, and
  no "entry not found" warning (confirms the disable resolves against a row
  a *different, earlier* bundle inserted, not just rows this bundle itself
  owns).
- A real `dsh --profile <name>` boot (no `--dump-config`) starts a working
  `dsh web` server — genuinely listens, prints a real URL, serves a valid
  200 response with the expected HTML bootstrap shell (`curl`-verified: real
  session cookie exchange, real page content, no server-side error).
- The served page's combo-script `<link rel=preload>` manifest —
  fetched and inspected directly — lists `dsh-plugins-client-ui-
  conversation-files/client.js`, `dsh-plugins-client-ui-workspace-
  files/client.js`, and `dsh-plugins-client-ui-workspace-enhanced/client.js`
  alongside every pristine package, and **`@deepseek-ai/dsh-client-ui-
  workspace/client.js` is absent** — direct, wire-level confirmation the
  disable took effect and the replacement is what the browser would actually
  fetch.
- The combo script itself (all Client bundles concatenated, ~4.8 MB
  unminified with sourcemaps) is served successfully and fast; all three of
  this repo's bundles pass `node --check` (syntax-valid).

What this does **not** confirm: that the page actually renders in a
browser. The Chrome extension used for this session's browser automation
could not complete a normal page load against this dev server — `document.
readyState` reported `"complete"` on a 219-byte, script-free document, well
short of the ~25 KB real page `curl` fetched with the same fresh, unused
auth token — while `curl` succeeded immediately every time. This looks like
an incompatibility between the extension's request handling and this
server's cookie/redirect-based auth flow (a `303` + `Set-Cookie` exchange),
not a problem with this repo's code — the server-side pipeline this
whole check exercises is identical whichever client asks for it — but it
means genuine visual/DOM rendering is still unverified. See "Genuine
browser-rendering verification" in Open items.

#### File tab: a pristine slot, but a fork-only trigger

`packages/client/ui-conversation-files` (the fork's own File-tab package)
turned out to be a genuinely clean citizen for its *slot*:
`dsh-client-ui-conversation`'s `conversation.view` is a real, pristine
`kind: 'list'` slot already populated by `ui-chat` (`id: 'chat'`) and
`ui-trajectory` (`id: 'trajectory'`) — the "Chat, File, and Trajectory"
tabs the user described. `dsh-plugins-client-ui-conversation-files`
registers a `'file'` entry into it exactly the same way, no upstream diff
required.

What the tab *displays*, though, was a different story: opening a file in a
session's File tab from OUTSIDE that session's own render tree — the
sidebar's Files tree is the motivating case — needs a cross-session bridge,
because `ConvViewOwnerProps.openView` is scoped to whichever session is
currently mounted, and the sidebar has no prop path into it. No pristine API
reaches a live per-session store instance from outside its own render tree
either: `ui-renderer`'s `SlotRegistry.resolveStore` (the code that creates
and holds per-session `StoreInstance`s) is private, and `StoreHandle.create()`
is documented "framework machinery and tests only" — calling it directly
from outside would create a disconnected instance, not the live one the
mounted component actually reads from.

The fork built exactly this bridge (`conversationFileOpener`, backed by a
`fileOpenRegistry` class): `dsh-client-ui-conversation`'s own `apply.ts`
gained the registry and a `pendingFileOpen` hook, and its skeleton component
`ConversationSession.tsx` gained the code that drains that hook into
`conversationStore`'s `openView` action. This repo now provides the same
bridge via `dsh-plugins-client-ui-conversation-enhanced`, following "Why
replace the plugin instead of patching it" above rather than touching the
vendored skeleton component: it disables `dsh-client-ui-conversation`'s own
row and inserts a replacement that forks only `ConversationSession`
(the one component whose render body needs the drain effect) while reusing
`ConversationRoot`, `ConversationSessionHeader`, `InputBar`, and every other
piece of the conversation shell unchanged from that package's own `./src/*`
export. `dsh-plugins-client-ui-workspace-files`'s `openFileInSession` still
degrades correctly when this package isn't composed in (`FilesNode` falls
back to its own in-app preview modal — see that package's README), so the
two packages remain independently useful.

#### Confirmed working: `dsh-plugins-client-ui-conversation-enhanced`

Same verification methodology as `dsh-plugins-client-ui-workspace-enhanced`
above, re-run against both disable+insert pairs together: `--dump-config`
shows `ui-conversation` (and `ui-workspace`) disabled with no "entry not
found" warning; a real `dsh --profile web-app` boot serves a working page
(`303` redirect, real `Set-Cookie` exchange, `200` on the authenticated
`GET /`); the served combo-script manifest lists `dsh-plugins-client-ui-
conversation-enhanced/client.js` and **omits**
`@deepseek-ai/dsh-client-ui-conversation/client.js`; the combo script itself
fetches `HTTP 200` (4.87 MB unminified with sourcemaps) with this package's
module id present and all 47 expected `window.__ModuleLoader__.load({...})`
calls intact. Same caveat as the `ui-workspace` replacement: genuine
browser-side DOM rendering is still unverified (see "Genuine
browser-rendering verification" in Open items) — this only confirms
composition and what the browser would actually be served.

Verifying against `web-app` also hit the bundle's own then-unconditional
`workspace-registry-seam` row duplicate-mounting `@deepseek-ai/dsh-workspace`
over `web-app`'s own `workspace` row — documented and since fixed in
`bundle-workspace-git/README.md` (the row is gone; that controller
dependency now resolves through `web-app`'s own mount instead), unrelated
to this package.

## Explicitly out of scope

`packages/shell/tool-bash`'s workdir-escape-preflight fix (also present in
the fork's diff) is a genuine upstream bug fix unrelated to either feature.
It belongs in its own PR against `deepseek-ai/deepseek-harness`, not in
either bundle here.

## Open items

- **Genuine browser-rendering verification.** See "Confirmed working:
  `dsh-plugins-client-ui-workspace-enhanced`" above — composition and the
  served combo-script manifest are wire-level verified; actual DOM
  rendering in a browser is not, blocked by what looks like a Chrome
  extension/dev-server auth incompatibility in this environment, not a
  known code issue. Re-attempt with a different browser-automation path
  (or a real user in a real browser) before calling the UI itself confirmed.
- **Bundle install order.** `dsh-plugins-bundle-workspace-git`'s
  `disabled: true` rows for `ui-workspace` and `ui-conversation` only
  resolve if `@deepseek-ai/dsh-web-app`'s own bundle (or whatever bundle
  mounts `dsh-client-ui-workspace`/`dsh-client-ui-conversation`) is already
  in `dsh.profile.bundles` *before* this one — `cordis.patch.yml` operations
  apply in bundle-list order, and a row from a not-yet-applied later bundle
  doesn't exist yet to disable. Verified directly: installing in the wrong
  order prints `patch: entry "ui-workspace" not found` (non-fatal, just a
  no-op) instead of erroring loud. Install `@deepseek-ai/dsh-web-app` first.
- **The `apps/web` frontend and library packages are built via standard `pnpm run build`.**
  `dsh web` serves `apps/web/dist/`, which is built automatically along with all
  host and client packages whenever running the standard build command inside
  `packages/_vendor/deepseek-harness`:
  ```sh
  cd packages/_vendor/deepseek-harness
  pnpm install
  pnpm run build
  pnpm dsh web
  ```
  *(or `pnpm run build:vendor` from the monorepo root)*.
- Confirm whether `dsh-plugins-api-workspace-git-controller` and
  `-file-controller` should merge into one controller package — they were
  split above by concern (git vs. generic file CRUD) but share no code.
- `packages/api/remotes` and `packages/api/session-controller` carried
  small (1-14 line) wiring diffs in the fork; verify whether Typert's
  auto-discovery genuinely needs zero such edits, or whether a comparably
  small, additive registration is unavoidable and worth proposing upstream.
- A faithful reference build of the vendored submodule compiles both host and
  client passes as well as the web UI frontend. Upstream's `pnpm run build`
  runs `build:lib` (`build:lib:host` and `build:lib:client`) and `build:web`
  according to the original specification, making all libraries and web assets
  ready for execution.
