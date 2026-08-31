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
`packages/_vendor/deepseek-harness/`. Every package here only *depends on*
published seams (`ctx.authorization`, Typert-registered Host controllers
auto-discovered by `dsh-typert-loader`, `dsh-cmdline`'s multi-plugin
argument parsing, and the `SlotMap` extension points `ui-workspace`,
`ui-conversation`, and `ui-settings-models` already declare) and installs
into a profile via `dsh plugin --profile <name> add <package>` (see
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
| `dsh-plugins-client-ui-workspace-files` | **Confirmed working (typecheck + build)** — optional `workspaceFilesNode` Context service (same pattern as `conversationFileOpener`, which is itself fork-only, not pristine prior art). Its mount point is a small drafted-and-verified diff, `upstream-patches/0001-workspace-files-node-optional-service.patch`, not yet proposed upstream (see "Files tree: why an optional service, not a slot") | `packages/client/ui-workspace/src/client/files/{FilesNode,FileViewer,classify}.tsx` — near-verbatim; also 7 icons the fork added directly to `ui-primitives` (`icons.tsx`, kept local) |
| `dsh-plugins-client-ui-conversation-files` | **Confirmed working (typecheck + build)** — registers into the *pristine* `conversation.view` list slot (`dsh-client-ui-conversation`), no upstream diff needed for the tab itself. `conversationFileOpener` (the cross-session open trigger) is separately fork-only and still needs its own upstream diff — see "File tab: a pristine slot, but a fork-only trigger" | `packages/client/ui-conversation-files/**` (already a clean, separate package in the fork — ported near-verbatim, repointed at `dsh-plugins-client-ui-file-editing`/this repo's own controllers instead of `ui-primitives`/the fork-extended `dsh-api-workspace-controller` client) |
| `dsh-plugins-bundle-workspace-git` | **Confirmed working** — installs via `dsh plugin --profile web-app add`; `dsh --profile acp` (with the bundle installed) boots to a clean `exit 0`, and a real `dsh --profile web-app` run stays alive and crash-free well past the point the pre-fix version threw (see the Client-face `.` export gotcha above). Genuine browser-side rendering (does the File tab/Files tree actually appear in a running web UI) is not verified — no live browser runtime available in this environment | New — replaces the direct edits to `packages/bundle/base/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml`; mounts `@deepseek-ai/dsh-workspace` itself (only `web-app` mounts it by default, mirroring `authorization-seam` below) |

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
independently reached the same conclusion, but it — provider and consumer
both — is a fork addition, not pristine code to build against.)
`dsh-plugins-client-ui-workspace-files` follows the documented convention
directly: `workspaceFilesNode: WorkspaceFilesNodeService | undefined`,
resolved once via `ctx.get('workspaceFilesNode')`. The upstream-ready diff
is then two small, mechanical touches to `ui-workspace/src/client/{index.ts,
rows/WorkspaceBrowser.tsx}` — resolve the service, thread it through
`WorkspaceBrowserInjected`/`SessionTreeProps` as a new prop, and render its
`Component` where `FilesNode` sat in the fork — not a new slot-registration
contract.

#### File tab: a pristine slot, but a fork-only trigger

`packages/client/ui-conversation-files` (the fork's own File-tab package)
turned out to be a genuinely clean citizen for its *slot*:
`dsh-client-ui-conversation`'s `conversation.view` is a real, pristine
`kind: 'list'` slot already populated by `ui-chat` (`id: 'chat'`) and
`ui-trajectory` (`id: 'trajectory'`) — the "Chat, File, and Trajectory"
tabs the user described. `dsh-plugins-client-ui-conversation-files`
registers a `'file'` entry into it exactly the same way, no upstream diff
required.

What the tab *displays*, though, is a different story: opening a file in a
session's File tab from OUTSIDE that session's own render tree — the
sidebar's Files tree is the motivating case — needs a cross-session bridge,
because `ConvViewOwnerProps.openView` is scoped to whichever session is
currently mounted, and the sidebar has no prop path into it. The fork built
exactly this bridge (`conversationFileOpener`, backed by a `fileOpenRegistry`
class), but unlike `workspaceFilesNode`'s optional-service fix, it isn't a
clean drop-in: `dsh-client-ui-conversation`'s own `apply.ts` gained the
registry and a `pendingFileOpen` hook, and its skeleton component
`ConversationSession.tsx` gained the code that drains that hook into
`conversationStore`'s `openView` action. Skeleton-component edits are a
materially bigger ask than a Context-service addition. This repo's
`dsh-plugins-client-ui-workspace-files` already degrades correctly without
it (`openFileInSession` returns `false`, `FilesNode` falls back to its own
in-app preview modal — see that package's README), so this bridge is
tracked as its own follow-up, not a blocker for either package landing.

## Explicitly out of scope

`packages/shell/tool-bash`'s workdir-escape-preflight fix (also present in
the fork's diff) is a genuine upstream bug fix unrelated to either feature.
It belongs in its own PR against `deepseek-ai/deepseek-harness`, not in
either bundle here.

## Open items

- No genuine browser-side verification of `dsh-plugins-client-ui-
  conversation-files`/`-workspace-files` yet — this environment has no live
  web app runtime. Everything checked so far is typecheck, build, and a
  Node-side boot not crashing; whether the File tab/Files tree actually
  render correctly in a running `web-app` UI is unverified.
- The `conversationFileOpener` cross-session bridge (see "File tab: a
  pristine slot, but a fork-only trigger") has no drafted diff yet, unlike
  `workspaceFilesNode`'s — it needs to touch `ui-conversation`'s skeleton
  component (`ConversationSession.tsx`), not just add a Context service, so
  it deserves its own careful read of that component before drafting.
- The upstream `ui-workspace` diff itself is drafted and verified:
  `upstream-patches/0001-workspace-files-node-optional-service.patch` —
  applies cleanly against the pinned submodule commit, and a forced clean
  `tsc -b` rebuild of `packages/client/ui-workspace` with it applied passed
  with no diagnostics. Not yet proposed as a real PR against
  `deepseek-ai/deepseek-harness`.
- Confirm whether `dsh-plugins-api-workspace-git-controller` and
  `-file-controller` should merge into one controller package — they were
  split above by concern (git vs. generic file CRUD) but share no code.
- `packages/api/remotes` and `packages/api/session-controller` carried
  small (1-14 line) wiring diffs in the fork; verify whether Typert's
  auto-discovery genuinely needs zero such edits, or whether a comparably
  small, additive registration is unavoidable and worth proposing upstream.
- A faithful reference build of the vendored submodule needs **both**
  `npm run build:lib:host` and `npm run build:lib:client` — some packages
  (`dsh-typert-registry`, `dsh-api-gateway`, and other dual-face packages
  using the `clientBundle()` tsdown helper) only emit `lib/index.js` during
  the *client* pass, even though nothing about their own consumption here
  is client-specific. Both passes are now run; this repo's own packages are
  host-only and build correctly either way. Running `packages/_vendor/deepseek-harness`'s
  own build scripts directly (`pnpm run build:lib:host`) rather than via
  `pnpm run <script>` triggers a `postinstall` failure specific to the
  submodule's git-worktree config (`install-lefthook.mjs` cannot enable
  `extensions.worktreeConfig` while `core.worktree` is set in the common
  config) — irrelevant to this repo (it's a dev-hooks convenience script),
  so both passes are invoked as `node --max-old-space-size=4096
  ./node_modules/typescript/bin/tsc -b tsconfig.{host,client}.json` +
  `./node_modules/.bin/tsdown --env.DSH_BUILD_FACE {host,client}` directly,
  bypassing `pnpm run`.
