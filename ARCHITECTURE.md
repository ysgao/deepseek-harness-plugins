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
`dsh-plugins-client-ui-workspace-enhanced` below and "Replace, don't
patch"). Either way, installation is `dsh plugin
--profile <name> add <package>` (see
`packages/_vendor/deepseek-harness/packages/bundle/README.md`).

## Core principles

Three rules govern every package in this repo, non-negotiably:

1. **Everything is a plugin.** Every feature — including one that replaces
   part of the shipped UI — is an ordinary `dsh` plugin package, installed
   through the ordinary `dsh plugin --profile <name> add <package>` /
   `remove` composition mechanism (see `packages/_vendor/deepseek-harness/
   packages/bundle/README.md`). There is no other installation path, no
   build-time flag, no environment variable that turns a feature on.

2. **Never patch, fork, or edit `packages/_vendor/deepseek-harness/`.** It
   is a pinned git submodule tracking `deepseek-ai/deepseek-harness`
   upstream; the only legitimate way its contents change is a pin bump
   (`git submodule update --remote` + `pnpm install`), reviewed like any
   other dependency bump, followed by re-verifying every plugin here still
   builds and boots against the new pin. A local patch, however small,
   however "temporary," reintroduces exactly the fork-divergence problem
   this repo exists to avoid (see "Why this repo exists" below) — this
   applies even to a patch that is never actually applied to the checked-in
   submodule, only drafted for someday proposing upstream (this repo used
   to keep exactly one such patch, in a since-deleted `upstream-patches/`
   folder; see "Replace, don't patch" below for why even that was wrong).

3. **A plugin's absence, or a plugin's failure, must never take down `dsh`
   itself.** Two distinct guarantees, both required, both hard-won this
   session (see "Plugin isolation" and "Testing procedures" below):
   - **Absence is normal, not an error.** A feature that depends on another
     out-of-tree package simply degrades — renders without the extra row,
     without the sign-in affordance, whatever the missing piece was — when
     that package isn't installed. This is ordinary Cordis lazy activation
     (`ctx.get(name)` for a value read once, `ctx.inject([...], cb)` for a
     seam a component subscribes through), used correctly.
   - **A misbehaving plugin fails loud in its own log, not by taking the
     whole app down.** Any operation that can genuinely fail at runtime
     (mounting a Remote contribution, most concretely, in every plugin this
     repo currently ships) must catch that failure and log it, never let it
     propagate out of its own `apply()`. This turned out to be the harder
     guarantee to get right — see "Plugin isolation" below for exactly why,
     and what "isolated into its own dedicated plugin" alone does *not*
     achieve.

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

## Plugin isolation

"Everything is a plugin" is not enough by itself — a plugin architecture
where one broken plugin can still blank the whole screen isn't actually
isolated, it just moved the failure one layer down. This repo's Client boot
(`@deepseek-ai/dsh-client-web`'s `AppWebEntry.runPluginBoot`/
`assertEntriesActive`, `packages/client/web/src/boot.ts`) enforces this the
hard way: after every top-level loader entry (every row in the composed
`cordis.yml`/`cordis.patch.yml` tree) has had a chance to activate, it walks
`ctx.loader.entries()` and throws if **any** of them is not `active` —
whether that entry's `apply()` threw, or it's merely stuck `pending` forever
waiting on a service nothing ever provided. Either state renders a blank
"Failed to load plugins" page for the *entire application*, not just the
feature that entry belongs to.

This was discovered, not assumed: `dsh-plugins-client-remotes-anthropic-
subscription`'s built bundle was deliberately patched to throw inside its
own `apply()` (fault injection — see "Testing procedures" below), and the
whole app went blank, falsifying an earlier assumption — that isolating a
`ctx.remote.$mount()` call into its own dedicated plugin was sufficient to
contain a mount failure. That isolation is necessary (see below) but not
sufficient on its own.

Two independent techniques are required together:

1. **A plugin whose job includes something that can genuinely fail at
   runtime — most concretely, mounting a Remote contribution — must be its
   own dedicated plugin, doing nothing else** (`dsh-plugins-client-remotes-
   workspace-git`, `dsh-plugins-client-remotes-anthropic-subscription`).
   Bundling that mount into a plugin that also registers UI (an earlier,
   rejected design here) would mean a mount failure throws the *whole*
   function, taking working UI registrations down with it — pure
   blast-radius containment, unrelated to point 2's fatal-boot problem, but
   still necessary on its own terms.
2. **That dedicated plugin's `apply()` must catch a mount failure and log
   it (`ctx.logger.error`), never let it propagate.** Because of
   `assertEntriesActive`, a throw from *any* top-level entry is fatal to
   the whole app regardless of how narrowly scoped that entry's own job is
   — isolating the mount into its own plugin only changes *what* throws,
   not *whether* a throw is fatal. Both `dsh-plugins-client-remotes-
   workspace-git` and `dsh-plugins-client-remotes-anthropic-subscription`
   wrap their `ctx.remote.$mount()` calls in try/catch and return a no-op
   disposer on failure — see each package's own README for the full
   reasoning and how it was verified.

A third, less obvious case: **a consumer of an optional cross-plugin
service must not require that service in its own top-level `inject`
array**, even though that is the ordinary, natural-looking way to declare a
dependency in Cordis. `dsh-plugins-client-ui-settings-anthropic-
subscription` originally listed `remote.authorization` in its own top-level
`inject` — correct-looking, and it does mean the plugin never *crashes* if
that service is never provided (Cordis's ordinary lazy-activation
semantics: the fiber just stays `pending`). But "pending forever" is
exactly the *other* condition `assertEntriesActive` treats as fatal for a
*top-level* entry — the fatal-boot outcome is identical to a thrown
exception, just reached a different way. The fix: keep the optional
service out of the plugin's own top-level `inject`, and instead request it
through a *nested* `ctx.inject(['remote.authorization'], (scope) => {...})`
call made from inside an already-satisfied `apply()`. A fiber created this
way is invisible to `ctx.loader.entries()` — it is not a top-level entry,
just an ordinary descendant Cordis fiber nested inside one that already
activated — so it can stay pending forever with no effect on
`assertEntriesActive` at all. The consuming component (`ModelsSection`)
treats the resulting value as genuinely optional
(`authorization?: IAuthorization | undefined`) throughout, rendering and
functioning normally either way; only the one feature that needs it (the
sign-in affordance) is absent when it's unavailable.

The rule this generalizes to, for every future plugin in this repo: **a
top-level plugin's own `inject` array should list only services whose
absence should legitimately block that plugin's own core purpose from
existing at all.** An optional enhancement to an otherwise-complete plugin
belongs behind a nested `ctx.inject()`/`ctx.get()` call inside an
already-activatable `apply()`, never in the top-level `inject` array — that
array is a promise this plugin makes to the whole app that it will not sit
there pending forever, and `assertEntriesActive` holds every top-level entry
to it.

This guarantee is about a plugin's own *optional* surface — infrastructure
the whole application depends on regardless of which plugins are installed
(the webserver itself failing to bind its port, for instance) still fails
loud and fatally, correctly so: nothing meaningful could happen without it,
so there is nothing to gracefully degrade to.

## Package inventory

### `packages/workspace-git/` — File manager + git

| Package | Seam it registers into | Ported from (`yga/deepseek-harness`) |
|---|---|---|
| `dsh-plugins-api-workspace-git-controller` | New Typert Host controller (auto-discovered by `dsh-typert-loader`; no edit to `api/workspace-controller`) | `packages/api/workspace-controller/src/workspace-git.ts` (status, commit-all, fetch, pull --rebase, push, discard-all) + `tests/workspace-git.host.spec.ts` |
| `dsh-plugins-api-workspace-file-controller` | New Typert Host controller | `packages/api/workspace-controller/src/{files,file-commands}.ts` (list/read/write/create/delete/diff) + their host specs |
| `dsh-plugins-client-ui-file-editing` | Standalone components (no shared-package dependency) | `packages/client/ui-primitives/src/{FileEditor,FilePreview,SideBySideDiff}.tsx` + `.module.css` + `codemirror/theme.ts` + `useSplitRatio.ts` + tests — moved out of the shared `ui-primitives` package, which every other UI plugin depends on |
| `dsh-plugins-client-ui-workspace-files` | **Confirmed working** — the sidebar Files tree and the optional `workspaceFilesNode` Context service it provides; typecheck + build + a real closure-factory bundle, confirmed present in a live `dsh web` combo-script manifest (see "Confirmed working" below) | `packages/client/ui-workspace/src/client/files/{FilesNode,FileViewer,classify}.tsx` — near-verbatim; also 7 icons the fork added directly to `ui-primitives` (`icons.tsx`, kept local) |
| `dsh-plugins-client-ui-workspace-enhanced` | **Confirmed working** — replaces `dsh-client-ui-workspace`'s own `sidebar.workspaces`/`conversation.hero.workspace` registrations wholesale (not a patch to that package); the only behavior change is rendering `workspaceFilesNode`'s `Component` as a Files sibling row. See "Replace, don't patch" | New package; forks only `rows/WorkspaceBrowser.tsx` from `packages/client/ui-workspace/src/client/`, near-verbatim plus the Files row; everything else (`WorkspacePicker`, `navigation.ts`, `stores.ts`, `tree.ts`, `locales.ts`, `Rows.tsx`) is imported unchanged from the original package's own `./src/*` export, not duplicated |
| `dsh-plugins-client-ui-conversation-files` | **Confirmed working** — registers into the *pristine* `conversation.view` list slot (`dsh-client-ui-conversation`), no upstream diff needed for the tab itself. Populated through `conversationFileOpener`, provided by `dsh-plugins-client-ui-conversation-enhanced` below | `packages/client/ui-conversation-files/**` (already a clean, separate package in the fork — ported near-verbatim, repointed at `dsh-plugins-client-ui-file-editing`/this repo's own controllers instead of `ui-primitives`/the fork-extended `dsh-api-workspace-controller` client) |
| `dsh-plugins-client-ui-conversation-enhanced` | **Confirmed working** — replaces `dsh-client-ui-conversation`'s own conversation-shell registration wholesale (not a patch to that package); the only behavior change is providing the `conversationFileOpener` cross-session bridge. See "File tab: a pristine slot, but a fork-only trigger" | New package; forks only `skeleton/ConversationSession.tsx`'s `ConversationSession` export from `packages/client/ui-conversation/src/client/`, near-verbatim plus a `pendingFileOpen` drain effect; everything else (`ConversationRoot`, `ConversationSessionHeader`, `InputBar`, the input hub, queue/settings docks, stores, locales) is imported unchanged from the original package's own `./src/*` export, not duplicated |
| `dsh-plugins-client-remotes-workspace-git` | **Confirmed working** — the dedicated plugin that mounts `dsh-plugins-api-workspace-file-controller`/`-git-controller`'s generated `/remote` Client contributions; catches and logs a `$mount` failure instead of letting it propagate (see "Plugin isolation" above) | New package; no fork counterpart — `dsh-typert-loader` only auto-discovers a package's Host `./typert` half, so the Client `./remote` half of a controller needs an explicit composition owner this repo provides itself |
| `dsh-plugins-bundle-workspace-git` | **Confirmed working** — installs via `dsh plugin --profile <name> add`; a real `dsh web` server boots and serves a working page whose combo-script manifest lists exactly the expected rows (all Client packages here present, both `@deepseek-ai/dsh-client-ui-workspace/client.js` and `@deepseek-ai/dsh-client-ui-conversation/client.js` absent — both disables took effect). See "Confirmed working" below for exactly what that checked and didn't | New — replaces the direct edits to `packages/bundle/base/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml`; mounts `@deepseek-ai/dsh-workspace` itself (only `web-app` mounts it by default, mirroring `authorization-seam` below); disables and replaces both the `ui-workspace` and `ui-conversation` rows (only present once `@deepseek-ai/dsh-web-app`'s own bundle has already inserted them — install order matters, see below) |

### `packages/anthropic-subscription/` — Anthropic subscription authorization

| Package | Status | Seam it registers into | Ported from (`yga/deepseek-harness`) |
|---|---|---|---|
| `dsh-plugins-api-authorization-controller` | **Confirmed working** — builds, installs, boots clean | New Typert Host controller, mounted as an independent top-level plugin — **not** nested inside `SettingsController`'s constructor the way the fork mounted it. That nesting turned out to be an organizational choice, not a requirement: the class only ever needed `ctx`, and `dsh-typert-loader` auto-discovers any top-level Loader entry that exports `./typert`. No edit to `api/settings-controller`. | `packages/api/settings-controller/src/authorization.ts` (271 lines) + `types.ts`'s authorization slice. Adapted to the current (newer-pinned) `dsh-typert-protocol` API: `TypertRemoteFailure({code,message,details})` was renamed to `RemoteError(code, message, details)`, keyed by a merge-extensible `RemoteErrorDetailsMap` a package declares its own codes into (`declare module '@deepseek-ai/dsh-typert-protocol' { interface RemoteErrorDetailsMap {...} }`) — this repo declares `authorization/not-found`, `authorization/in-flight`, `authorization/rejected`, `authorization/prompt-not-found`. |
| `dsh-plugins-cli-login-app` | **Confirmed working** — builds, installs, boots clean, `--help` prints correctly | Its own standalone `dsh --profile <name>` application, **not** a `login` subcommand added to `@deepseek-ai/dsh-headless`. See "CLI login: why its own profile" below. | `packages/bundle/headless/src/index.ts`'s `login` mode (`buildTerminalInteraction`/`runLogin`) — the fork wove it into `headless-runner`'s shared `Config`/`apply()` instead of giving it independent argument grammar. |
| `dsh-plugins-client-remotes-anthropic-subscription` | **Confirmed working** — the dedicated plugin that mounts `dsh-plugins-api-authorization-controller`'s generated `/remote` Client contribution (the `authorization` namespace); catches and logs a `$mount` failure instead of letting it propagate (see "Plugin isolation" above) | Mounts the `authorization` Remote namespace | New package; no fork counterpart — same auto-discovery gap as `dsh-plugins-client-remotes-workspace-git` above |
| `dsh-plugins-client-ui-settings-anthropic-subscription` | **Confirmed working** — replaces `dsh-client-ui-settings-models`'s own `settings.section`/`settings.onboarding` registrations wholesale (not a patch to that package); the only behavior change is the sign-in affordance next to the API-key field. See "Settings UI: replacing the plugin, not patching it" below | Disables and replaces the `ui-settings-models` row | `packages/client/ui-settings-models/src/client/{AuthorizationPanel.tsx,authorization-runtime.ts}` + the diff across `ProviderEditor.tsx`/`ModelsSection.tsx`/`client/index.ts` that wires them in — adapted onto this repo's currently-vendored, newer `ui-settings-models` API rather than copied from the fork's own (older, diverged) snapshot; see "Settings UI" below. |
| `dsh-plugins-bundle-anthropic-subscription` | **Confirmed working** — `dsh plugin --profile <name> add` (tested via a cloned, disposable test profile — see "Testing procedures" below) reconciles into `dsh.profile.bundles`; a real boot renders Settings > Models with the sign-in panel present, and a deliberate fault-injection test confirmed the app still boots and Models still works even with the authorization mount broken | `cordis.patch.yml` bundle for `web`/`headless`/`acp`/`sdk` (`dsh-base`-derived) profiles — inserts `@deepseek-ai/dsh-authorization` itself (absent from every shipped bundle upstream — see below), `authorization-controller`, `remotes-anthropic-subscription`, and disables+replaces the `ui-settings-models` row with `ui-settings-anthropic-subscription` | New |

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

#### Settings UI: replacing the plugin, not patching it

`ui-settings-models` declares exactly two extension slots
(`settings.models.provider-card`, `settings.models.footer` — see its own
`slot-contract.ts`), and neither reaches inside `ProviderEditor`'s own card
body, where a "sign in" affordance next to the API-key field has to render
— the fork's own diff imports and renders `AuthorizationPanel` directly
inside `ProviderEditor.tsx`, right after the API-key input field.
`ProviderEditor`'s `authorization?: IAuthorization` prop is already fully
generic (its own doc: *"a route the catalog does not register a flow
for... correctly shows none"*), so this reads as intentional,
well-designed functionality that was simply never split into its own
capability seam.

An earlier assessment of this repo concluded that gap meant this feature
"can't be a pure plugin" and should be proposed as a small upstream PR
instead, leaving Settings sign-in unimplemented here — treating this case
as fundamentally different from the identical Files-row gap in
`ui-workspace`. It isn't: `dsh-plugins-client-ui-settings-anthropic-
subscription` applies the exact same "Replace, don't patch" pattern used
there (see above). `cordis.patch.yml` disables the original `ui-settings-
models` row (`{id: ui-settings-models, disabled: true}`) and inserts a full
replacement that forks only the four files that actually change —
`ModelsSection.tsx`, `ProviderEditor.tsx`, `client/index.ts`, and
`locales.ts` (four new copy keys) — reusing everything else
(`CustomProviderCard`, `DeepSeekModelsEditor`, `DeepSeekOnboardingDialog`,
`WelcomeNotice`, `welcome-store`, `store`, `operations`,
`schema-operations`, `slot-contract`, `EditorFooter`, `ModelListEditor`,
`apiKey`, `ModelsSection.module.css`, `onboarding-copy`) as real values
from that package's own `./src/*` export, exactly like `dsh-plugins-
client-ui-workspace-enhanced` does for `dsh-client-ui-workspace`.

Porting from `yga/deepseek-harness` surfaced a second, unrelated problem
worth naming here: that fork's own `ui-settings-models` snapshot had
already diverged from this repo's currently vendored, newer pin
(`ModelsWire`/`api` refactored to `ModelsOperations`/`operations`,
`JsonValue` relocated to `@deepseek-ai/dsh-util-values`, `messageOf`
removed, two new locale keys, `ModelsSettingsStore`'s constructor taking
`ctx` directly instead of a wire object). Every forked file here targets
the *current* vendored API, adapting the fork's diff onto it rather than
copying the fork's snapshot verbatim — a reminder that porting from
`yga/deepseek-harness` always needs a diff against the currently pinned
commit, not just the fork's own source, since the two can and do drift
independently. See "Confirmed working: `dsh-plugins-client-ui-settings-
anthropic-subscription`" below for how this was verified.

#### Confirmed working: `dsh-plugins-client-ui-settings-anthropic-subscription`

Verified end to end, including the part the earlier `workspace-git`
verification round couldn't reach (see "Genuine browser-rendering
verification" in Open items, now resolved):

- `dsh --profile <name> --dump-config` shows `ui-settings-models` disabled
  and `ui-settings-anthropic-subscription` inserted in its place.
- `dsh plugin --profile <name> remove`/`add dsh-plugins-bundle-anthropic-
  subscription`, run against a real (cloned, disposable) profile, correctly
  removes/reconciles the bundle into `dsh.profile.bundles` — the actual
  install/uninstall command a user runs, not just a manual `package.json`
  edit. See "Testing procedures" below for the exact steps.
- A real `dsh web` boot serves a working page; genuine DOM interaction in a
  real Chrome tab (not just `curl`) — clicking through to Settings > Models,
  confirmed via the page's own rendered text — shows all five configured
  providers (DeepSeek, anthropic, google, LM Studio, LlamaCPP), the
  `anthropic` provider's editor card opening and closing cleanly, and
  Settings > Plugins' "Global plugins" list showing `authorization`/
  `plugins-api-authorization-controller` as installed and enabled. No
  console errors at any point.
- Fault injection (see "Testing procedures" below) confirmed the
  degradation path holds: with the authorization mount deliberately
  broken, the app still boots, Settings > Models still renders and
  functions normally, and only the sign-in affordance is absent — not a
  blank "Failed to load plugins" page.

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

#### Replace, don't patch

The service exists (`workspaceFilesNode`, declared by `dsh-plugins-client-
ui-workspace-files` itself — see above); something still has to *resolve*
it and render its `Component` where `FilesNode` sat in the fork, and
pristine `dsh-client-ui-workspace` doesn't do that. A small source patch to
`ui-workspace/src/client/{contract/slots.ts, index.ts, rows/
WorkspaceBrowser.tsx}` would be genuinely small — three files, ~50 lines —
but applying it locally would mean either forking `deepseek-ai/deepseek-
harness` to hold the patched commit (a real repo to maintain, a submodule
re-pin, and every future pin bump needs the patch rebased forward) or
hand-patching the pinned submodule's working tree outside of git history
(fragile — nothing forces a fresh clone to reapply it, and a dirty
submodule risks an accidental bad commit landing in the pin). Per "Core
principles" above, neither is acceptable regardless of how small the diff
is — this repo does not carry vendor patches, staged or applied,
"temporary" or not.

The alternative `cordis.patch.yml` already provides: `{id, disabled:
true}` alongside `{insert: [...]}` — ordinary composition operations, not
a new mechanism. Disable the row `@deepseek-ai/dsh-web-app`'s own bundle
inserts for `dsh-client-ui-workspace`, insert `dsh-plugins-client-ui-
workspace-enhanced` in its place, and let the replacement register the
exact same slots the original did, plus the one new row. This is what this
repo does, on direct instruction: "everything is a plugin" applies to the
seam-providing side too, not just the feature side — unplug the original,
plug in an enhanced one, entirely through the same `dsh plugin add`
composition mechanism every other package here already uses. No fork of
`deepseek-ai/deepseek-harness`, no submodule pin tied to a patch branch, no
vendored file touched even transiently, no patch file staged anywhere in
this repo either. The replacement package reuses everything it isn't
changing: `dsh-client-ui-workspace` declares `"./src/*": "./src/*"` in its
own `exports` map (a convention this whole codebase uses), so
`WorkspacePicker`, `UiWorkspaceService`, `createWorkspaceViewStore`,
`tree.ts`'s group-deriving logic, and the `workspace` locale dictionaries
are all imported as real values from that path — not copied. Only
`rows/WorkspaceBrowser.tsx` (the one file that actually changes) is forked,
with import paths repointed the same way `FilesNode.tsx` was in Task 18.

An earlier revision of this repo kept a drafted, `git apply --check`-clean
small source patch in `upstream-patches/` as a "prepare it, don't submit
it" reference for someday proposing the addition to `deepseek-ai/deepseek-
harness` directly. That folder has been deleted: keeping a patch on file at
all, even unapplied, sits uncomfortably next to "never patch the vendor" —
it invites exactly the temptation the principle exists to close off, and it
duplicated the plugin's own already-complete, already-shipped functionality
for no operational reason. Nothing here ever depended on it landing
upstream; `dsh-plugins-client-ui-workspace-files`'s own optional-service
declaration (see above) already achieves everything the patch would have.
A genuinely upstream-worthy idea belongs in a real PR against
`deepseek-ai/deepseek-harness`, filed from a personal fork when someone has
time to shepherd it through review — never as a file sitting in this repo.

`dsh-plugins-client-ui-conversation-enhanced` applies the identical
replace-don't-patch pattern to `dsh-client-ui-conversation`'s own
conversation-shell registration, for the `conversationFileOpener` bridge —
see "File tab: a pristine slot, but a fork-only trigger" below.
`dsh-plugins-client-ui-settings-anthropic-subscription` applies it a third
time, to `ui-settings-models`'s `settings.section`/`settings.onboarding`
registrations — see "Settings UI: replacing the plugin, not patching it"
below.

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

At the time this was first written, genuine browser DOM rendering was
still unverified: the Chrome extension's `navigate()` tool (CDP-initiated
navigation) could not complete a normal page load against this dev server
— `document.readyState` reported `"complete"` on a 219-byte, script-free
document, well short of the ~25 KB real page `curl` fetched with the same
fresh, unused auth token, while `curl` succeeded immediately every time.
The cause turned out to be the navigation method, not this repo's code:
CDP-initiated navigation didn't send the server's `SameSite=Strict` auth
cookie correctly, while page-initiated navigation (`location.href = url`/
`location.reload()`, driven through the extension's JS-execution tool
instead) works reliably. Real DOM interaction — clicking through Settings,
reading rendered page text, checking the console — has since confirmed
this sidebar (visible throughout every later session's browser checks) and
`dsh-plugins-client-ui-settings-anthropic-subscription` both actually
render and function correctly, not just serve a valid bundle. See
"Testing procedures" for the technique and the Open Items entry this
resolved.

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
bridge via `dsh-plugins-client-ui-conversation-enhanced`, following "Replace,
don't patch" above rather than touching the
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
calls intact. Genuine browser-side DOM rendering — initially unverified
here for the same reason noted in the `ui-workspace` replacement's own
"Confirmed working" section above — has since been confirmed through real
DOM interaction (see "Testing procedures").

Verifying against `web-app` also hit the bundle's own then-unconditional
`workspace-registry-seam` row duplicate-mounting `@deepseek-ai/dsh-workspace`
over `web-app`'s own `workspace` row — documented and since fixed in
`bundle-workspace-git/README.md` (the row is gone; that controller
dependency now resolves through `web-app`'s own mount instead), unrelated
to this package.

## Testing procedures

Two things need testing for any plugin change in this repo: the ordinary
install path (`dsh plugin add`/`remove` actually works, the way a real user
would run it), and the failure path (this repo's "a plugin's failure must
never take down `dsh`" guarantee actually holds, not just in theory).

### Test `dsh plugin add`/`remove` on a disposable profile, never on a live one

Never run `dsh plugin --profile <name> add`/`remove` against a profile a
real session (yours or anyone else's) is actively using — `pnpm install`/
`remove` rewrites `package.json`/`node_modules` on disk, and while an
already-running server process isn't directly disrupted by that (Node has
already loaded what it needs into memory), a live browser tab's next
refresh or hot-reload would pick up a half-changed state mid-test. Clone
the profile into a scratch name first:

```sh
ditto ~/.dsh/profiles/web ~/.dsh/profiles/web-verify
```

(macOS; handles the symlink-heavy pnpm `node_modules` tree correctly —
plain `cp -r` does not, it fails with repeated "directory causes a cycle"
errors walking pnpm's nested symlinks.)

Then, from `packages/_vendor/deepseek-harness` (the CLI's source-launch
location; `node --import tsx/esm apps/cli/src/bin.ts <args>` has been more
reliable here than `pnpm run dsh -- <args>`, which has been observed to
mis-parse a `--profile` flag depending on argument order):

```sh
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web-verify \
  remove dsh-plugins-bundle-anthropic-subscription
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web-verify \
  add /absolute/path/to/packages/anthropic-subscription/bundle-anthropic-subscription
cat ~/.dsh/profiles/web-verify/package.json   # confirm dsh.profile.bundles
                                               # reconciled correctly
node --import tsx/esm apps/cli/src/bin.ts --profile web-verify \
  --port 0 --no-open                          # port 0: let the OS pick a
                                               # free port, so this never
                                               # collides with a live
                                               # session's own port
```

Open the printed `http://127.0.0.1:<port>/?token=...` URL, confirm the new
feature actually renders (`document.body.innerText` on the loaded page is
a reliable, scriptable way to check this without relying on screenshots),
then `kill` the process and `rm -rf ~/.dsh/profiles/web-verify` when done.
Never leave a stray test server or test profile behind.

### Fault-inject a plugin to prove `dsh` survives it

This is the test that actually exercises "a plugin's failure must never
take down `dsh`" — passing typecheck and a happy-path boot proves nothing
about this guarantee, only a deliberate failure does. Patch the **built**
output (never the committed source) of the plugin under test to fail,
backing up the file first:

```sh
cp packages/<group>/<package>/lib/client.js /tmp/client.js.bak
# edit lib/client.js: make its apply() throw, e.g. replace the first line
# of the function body with: throw new Error('SIMULATED FAILURE: ...')
```

Reboot against the disposable test profile above, open the page, and check
both the console and the rendered page text for one of two outcomes:

- **Before the plugin correctly contains its own failures**: a blank
  "HARNESS / Failed to load plugins" page, `document.body.innerText`
  showing nothing else — confirms the failure really is fatal without a
  fix (this is what surfaced the gap "Plugin isolation" above describes;
  reproduce it once on purpose so a fix's effect is legible against a real
  before/after, not assumed).
- **After the fix**: the app boots and renders completely normally — the
  broken plugin's own log line and, if applicable, one absent feature are
  the *only* visible effect. Confirm the rest of what that plugin's bundle
  sits near — the settings page it contributes to, the sidebar section
  nearby, whatever else shares the same boot — still works exactly as it
  does without the fault injected.

Restore the backed-up file (`cp /tmp/client.js.bak lib/client.js`) and
confirm a fresh `tsdown` build of the same package produces byte-identical
output (`diff`) before considering the test clean — the built artifact must
carry zero trace of the injected fault once done.

### What each check catches

| Check | Catches |
|---|---|
| `tsc -b` (package + `tsconfig.client.json` full aggregate) | Type errors, including ones only visible once a package is wired into the whole client program (e.g. a locale key union mismatch between a fork and the package it forked from) |
| `pnpm run build` (host then client, per group) | Bundler-level failures — a cross-package import the purity gate rejects, a CSS Modules specifier the resolver can't follow, a Typert generator mismatch |
| `--dump-config` | The composed `cordis.yml` tree is well-formed and reads as expected. Does *not* by itself confirm a disable/insert row resolved against something real — a `disabled: true` targeting a row that doesn't exist yet prints a non-fatal "entry not found" instead of erroring loud; read the printed tree, don't just check the command exits 0 |
| A real boot + `--dump-config` together | The install-order dependency between bundles (a `disabled: true` needs the row it targets already inserted by an earlier bundle) |
| A real boot + real browser DOM interaction | The feature actually renders and functions — composition and a served bundle manifest are necessary but not sufficient; only clicking through in a real page confirms the UI itself works |
| Fault injection | The one guarantee none of the above checks exercise at all: that a plugin failing doesn't take the rest of `dsh` down with it |

## Explicitly out of scope

`packages/shell/tool-bash`'s workdir-escape-preflight fix (also present in
the fork's diff) is a genuine upstream bug fix unrelated to either feature.
It belongs in its own PR against `deepseek-ai/deepseek-harness`, not in
either bundle here.

## Open items

- ~~**Genuine browser-rendering verification.**~~ **Resolved.** The Chrome
  extension's `navigate()` tool (CDP-initiated navigation) was the actual
  blocker — it did not send this server's `SameSite=Strict` auth cookie
  correctly; page-initiated navigation (`location.href = url`/
  `location.reload()`, driven through the extension's JS-execution tool
  instead of its navigate tool) works reliably. Real DOM interaction —
  clicking through Settings, opening a provider editor card, reading
  rendered page text, checking the console for errors — has since
  confirmed both `dsh-plugins-client-ui-workspace-enhanced` (its sidebar
  was visible throughout later sessions' checks) and `dsh-plugins-client-
  ui-settings-anthropic-subscription` actually render and function
  correctly in a real browser, not just serve a valid bundle. See
  "Confirmed working: `dsh-plugins-client-ui-settings-anthropic-
  subscription`" above and "Testing procedures" for the technique.
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
