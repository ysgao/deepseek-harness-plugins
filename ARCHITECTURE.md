# Architecture

This repo hosts four independent, **out-of-tree** `dsh` plugin bundles:

1. **`packages/workspace-git/`** — the File manager sidebar (file tree,
   preview, in-app edit, side-by-side git diff) and its git status/commit
   /fetch/pull-rebase/push actions.
2. **`packages/anthropic-subscription/`** — Anthropic subscription
   authorization, in the CLI and in the Models settings UI.
3. **`packages/terminal/`** — the bottom terminal panel, an in-repo fork of
   the third-party npm package `dsh-plugin-terminal` (not of
   `deepseek-harness`) — see "Why fork instead of patching `node_modules`"
   in its own `README.md`.
4. **`packages/mcp-connector/`** — MCP connectors, including remote servers
   behind OAuth 2.0: a superset of `dsh-mcp-client`, a durable connector
   registry, its RPC controller, a Settings page, and a CLI.

None of the first two bundles patch, copy, or fork any file under
`packages/_vendor/deepseek-harness/`. Every package in them either *depends
on* a seam the vendor already publishes (a Typert-registered Host
controller auto-discovered by `dsh-typert-loader`, `dsh-cmdline`'s
multi-plugin argument parsing, an existing `SlotMap` extension point), or —
where no such seam exists — *replaces* one existing plugin registration
wholesale with an enhanced out-of-tree one (see "Replace, don't patch").
`packages/terminal/` is a different shape: it forks a third-party plugin,
not anything from the vendor, and *inserts* additively (no row it disables
or replaces) — it depends on the same `ctx.webServer`/`ctx.connection`
seams the vendor publishes, same as the other two. Installation is always
`dsh plugin --profile <name> add <package>` (see
`packages/_vendor/deepseek-harness/packages/bundle/README.md`).

## Core principles

The short, non-negotiable form of this list — the rules the rest of this
document is not allowed to contradict, and how each is enforced — lives in
[`CONSTITUTION.md`](CONSTITUTION.md). What follows adds the reasoning.

1. **Everything is a plugin.** Every feature — including one that replaces
   part of the shipped UI — is an ordinary `dsh` plugin package, installed
   through `dsh plugin --profile <name> add`/`remove`. There is no other
   installation path, no build-time flag, no environment variable that
   turns a feature on.

2. **Never patch, fork, or edit `packages/_vendor/deepseek-harness/`.** It
   is a pinned git submodule tracking `deepseek-ai/deepseek-harness`. The
   only legitimate way its contents change is a pin bump (`git submodule
   update --remote` + `pnpm install`), followed by re-verifying every
   plugin here still builds and boots against the new pin — and, for the
   three replacement plugins, that each still covers everything the vendor
   row it disables does at the new pin ("Replacement parity" below).

3. **A replacement is a superset of what it replaces — always.** A
   `disabled: true` row takes every one of its own registrations with it,
   so a slot, locale key, service, or config field the original had and the
   replacement lacks is not a missing enhancement: it is a feature the user
   loses by installing this repo's bundle. Every vendor pin bump is an
   opportunity to break this silently, which is why proving it is a step of
   the bump itself — see "Replacement parity" below.

4. **A plugin's absence, or a plugin's failure, must never take down `dsh`
   itself.**
   - **Absence is normal, not an error.** A feature that depends on another
     out-of-tree package simply degrades — renders without the extra row,
     without the sign-in affordance, whatever the missing piece was — when
     that package isn't installed.
   - **A misbehaving plugin fails loud in its own log, not by taking the
     whole app down.** Any operation that can genuinely fail at runtime
     (mounting a Remote contribution, most concretely) must catch that
     failure and log it, never let it propagate out of its own `apply()`.
     See "Plugin isolation" below for exactly what this requires.

## Dependency source

`@deepseek-ai/dsh-*` packages are not published to npm (only
`@deepseek-ai/cordis` is). `packages/_vendor/deepseek-harness/` is a git
submodule pinned to a `deepseek-ai/deepseek-harness` commit;
`pnpm-workspace.yaml` folds its `packages/*/*`, `vendor/*` (Cordis,
cosmokit, schemastery, …), `apps/*`, and `native/system` (the
node-addon-system tier, named `native/landlock-run` before upstream
broadened it past the Landlock launcher) into this workspace so
`workspace:^` dependencies resolve against real upstream sources. It also
folds in `benchmarks`, `website`, and `python/sdk-runtime` — unused here,
but the vendored `tsconfig.host.json` typechecks the first two, so
`build:vendor` fails without their dependencies installed.

**Nested under `packages/`, not a sibling `vendor/` directory.** This one
is load-bearing, not cosmetic: `dsh-typert-generator`'s workspace-mode
analysis only recognizes `@deepseek-ai/dsh-typert-protocol` — the package
`Remote`/`TypertRemoteService`/`RemoteScope` decorators must resolve back
to — when that package's real (symlink-resolved) path lives under
`<workspaceRoot>/packages/`. A sibling `vendor/` mount makes every
`@Remote` method in this repo's own controllers silently invisible to the
generator. Two things follow from nesting packages correctly:
`tsconfig.host.json` references `.../packages/typert/protocol` **directly**
(not only transitively), since `loadRegistrations()` only walks the
aggregate config's own top-level `projectReferences`; and
`tsconfig.base.json` maps `@deepseek-ai/dsh-typert-protocol` to that
package's `src/index.ts` via a `paths` entry (not its built `.d.ts` via
`node_modules`) — the generator's own `ts.createProgram()` call needs one
flat program with one `ts.Symbol` for `TypertRemoteService`, not two
produced by resolving the same package two different ways.

**Every package that ships a `./typert` export declares `zod` as a real
dependency.** `dsh-typert-loader` validates each generated schema
structurally (`'_zod' in schema && typeof schema.parse === 'function'`)
rather than by `instanceof`, so an undeclared `zod` can silently resolve to
whatever copy Node's module resolution finds first outside the workspace —
a v3 copy with no `_zod` property fails at boot with "parameter codec is
not backed by a zod v4 schema" and no hint about why. Declaring `"zod":
"^4.4.3"` (matching `dsh-typert-protocol`'s own pin) avoids it.

**A Client-face package's default (`.`) export must be Host-safe — no
transitive CSS Modules import.** The Host Loader imports every
`cordis.patch.yml` row's `.` export during composition, even for a row
whose package only declares a `dsh.client` face; a plain Node ESM import
throws `ERR_UNKNOWN_FILE_EXTENSION` on a `.css` import (only a browser
bundle's CSS-modules-inline transform resolves those). Every Client-face
package here splits into a Host-safe no-op at `.` and the real code under
`./client` (declared via `dsh.client` in `package.json`, resolved only by
the browser-side loader) — the same two-entry-point shape pristine
`dsh-client-ui-workspace` itself uses.

**The vendored `clientConfig()`/`clientBundle()` tsdown preset
(`packages/client/tsdown.client.ts`) can't build an out-of-tree package.**
It locates a package's manifest by globbing under the vendored submodule's
own hardcoded root, with no override — a package under this repo's own
`packages/` is invisible to it. `tsdown.client-plugin-preset.ts` (repo
root) reproduces the same wire contract instead — the closure-factory
banner/footer (`window.__ModuleLoader__.load({id, factory})`), the CSS
Modules inline transform, and the cross-plugin import purity gate —
reusing what's genuinely exported for reuse (`requestedExternals`, a pure
function; `PLATFORM_MODULES`/`PRELOADED_CLIENT_EXTERNALS` via
`dsh-client-web`'s own declared `./src/*` export) rather than the
internals.

That reproduction is incremental by design: a piece of `clientConfig()` is
ported the first time a package here genuinely needs it, not speculatively.
Three were added for `dsh-plugins-client-ui-document-host` (see "Document
preview: relocate the seat, never the renderers"), and each generalizes
beyond it:

- **`.css?inline` and plain `.css` imports.** The CSS Modules transform was
  the only stylesheet shape this repo had needed. A package that inlines
  another package's component tree inherits *its* stylesheet imports, and a
  third-party library's stylesheet is neither a CSS Module nor optional
  (`@fortune-sheet/react/dist/index.css?inline` is the spreadsheet grid's
  entire appearance). `?inline` hands the text to the importer; a plain
  `.css` import is a global side-effect stylesheet and injects itself.
- **Package-local lazy chunks** (`codeSplitting`, `clientBanner`, and
  `asyncChunkRequirePlugin`). Off by default — one file, one request, no
  loader cooperation — because that is right for a package whose whole graph
  is small. A package inlining deliberately-lazy heavy bodies (a PDF
  runtime, a spreadsheet grid) needs the opposite, or megabytes land on
  every boot. The rewrite is the load-bearing half: without turning the
  generated `Promise.resolve().then(() => require('./client.pdf.js'))` into
  `require.async('./client.pdf.js')`, the chunk is built and served and
  *never fetched*.

Nothing about the loader's chunk route is in-tree-only, which is what makes
the second one work out of tree at all: `graphRow` gives every plugin row
its own single-resource URL (`/??<id>/client.js&rev=…`), which is exactly
what `system.ts`'s `chunkUrl` requires to resolve a sibling, and the server's
`chunkResponse` serves any `client.<name>.js` sitting beside a registered
plugin's own `clientPath`.

No shipped bundle mounts `@deepseek-ai/dsh-authorization` by default in a
pristine `deepseek-ai/deepseek-harness` checkout, so both bundles here
mount it themselves (`id: authorization-seam`) — each is self-sufficient
regardless of what profile it lands in.

## Plugin isolation

This repo's Client boot (`@deepseek-ai/dsh-client-web`'s
`AppWebEntry.runPluginBoot`/`assertEntriesActive`,
`packages/client/web/src/boot.ts`) walks every top-level loader entry
(every row in the composed `cordis.yml`/`cordis.patch.yml` tree) once boot
finishes, and throws if **any** of them is not `active` — whether that
entry's `apply()` threw, or it's merely stuck `pending` forever waiting on
a service nothing ever provided. Either state renders a blank "Failed to
load plugins" page for the *entire application*, not just the feature that
entry belongs to. Isolating an operation into its own dedicated plugin
changes *what* fails, not *whether* a failure is fatal — both techniques
below are required together:

1. **A plugin whose job includes something that can genuinely fail at
   runtime — most concretely, mounting a Remote contribution — is its own
   dedicated plugin, doing nothing else** (`dsh-plugins-client-remotes-
   workspace-git`, `dsh-plugins-client-remotes-anthropic-subscription`).
   Bundling that mount into a plugin that also registers UI would mean a
   mount failure throws the *whole* function, taking working UI
   registrations down with it.
2. **That dedicated plugin's `apply()` catches a mount failure and logs it
   (`ctx.logger.error`), never lets it propagate.** A throw from *any*
   top-level entry is fatal to the whole app regardless of how narrowly
   scoped that entry's own job is — isolating the mount into its own
   plugin only changes what throws, not whether a throw is fatal.

A consumer of an optional cross-plugin service must not require that
service in its own top-level `inject` array, even though that is the
ordinary, natural-looking way to declare a Cordis dependency: a fiber stuck
`pending` forever is exactly as fatal, for a *top-level* entry, as a thrown
exception. `dsh-plugins-client-ui-settings-anthropic-subscription` requires
`remote.authorization` through a *nested*
`ctx.inject(['remote.authorization'], (scope) => {...})` call made from
inside an already-satisfied `apply()` instead. A fiber created this way is
invisible to `ctx.loader.entries()` — it is not a top-level entry, just an
ordinary descendant Cordis fiber nested inside one that already activated —
so it can stay pending forever with no effect on `assertEntriesActive` at
all. The consuming component treats the resulting value as genuinely
optional (`authorization?: IAuthorization | undefined`) throughout,
rendering and functioning normally either way; only the one feature that
needs it is absent when it's unavailable.

**Rule for every plugin in this repo: a top-level plugin's own `inject`
array lists only services whose absence should legitimately block that
plugin's own core purpose from existing at all.** An optional enhancement
to an otherwise-complete plugin belongs behind a nested
`ctx.inject()`/`ctx.get()` call inside an already-activatable `apply()`,
never in the top-level `inject` array.

This guarantee is about a plugin's own *optional* surface — infrastructure
the whole application depends on regardless of which plugins are installed
(the webserver itself failing to bind its port, for instance) still fails
loud and fatally, correctly so: nothing meaningful could happen without it.

### Replaced-plugin resilience

A replacement plugin (see "Replace, don't patch" below) carries two further
containment layers, for risks that pattern specifically introduces.

**Every `ctx.slots.register()` call in a replacement plugin registers at
`priority: -1`, one lower than a plugin's own default (0).** Two
registrations into the same slot only throw when they share the exact same
priority; a lower priority instead shadows deterministically — the lowest
priority present is the one that renders — with no throw at all.
`dsh-plugins-client-ui-workspace-enhanced`, `dsh-plugins-client-ui-
conversation-enhanced`, and `dsh-plugins-client-ui-settings-anthropic-
subscription` all use this, so a `disabled: true` operation that silently
failed to find its target (see "Bundle install order" in Open items) no
longer crashes the app purely from the resulting duplicate slot
registration.

**`dsh-plugins-client-ui-workspace-enhanced` and `dsh-plugins-client-ui-
conversation-enhanced` also fall back to the pristine plugin's own
unmodified `apply(ctx)` if their own enhanced setup fails before any
registration is attempted** — safe because nothing of the replacement's has
registered yet at that point, so calling the pristine `apply()` fresh cannot
double-register anything. Past that point, each individual slot
registration is separately try/catch-guarded instead (logging and leaving
just that one row unregistered on failure): falling back to a full pristine
replay after some registrations already succeeded would double-register
those and crash on exactly the same collision this whole section exists to
prevent.

That fallback loads the pristine `apply` through a dynamic `import()` inside
the `catch` branch, not a static top-level import — both packages used a
static import for this until it caused a real incident. A static import of
vendor's `apply.ts` evaluates unconditionally at module load, on every
install, whether or not the fallback branch ever runs; evaluating it also
evaluates every component vendor's `apply.ts` imports, including the exact
same-named CSS Module the fork itself owns and forked
(`ConversationRoot.module.css`, `WorkspaceBrowser.module.css`). Both land in
the same bundle and inject under the same `<style data-plugin-css>` tag id —
`styleInjectionModule` (`tsdown.client-plugin-preset.ts`) used to derive that
id from a CSS Module's basename alone, so the two collided, and its
`document.querySelector(...) === null` injection guard silently skipped
whichever one lost the race. In `dsh-plugins-client-ui-conversation-
enhanced`'s case, vendor's `apply.ts` — imported this way purely for its
fallback value — evaluated first and won, leaving `ConversationRoot`'s own
DOM rendered with the fork's scoped classnames but only vendor's rules ever
inserted for that tag: `.scrollBody`'s `overflow-y: auto` and `.root`'s
`overflow: hidden` never applied, breaking mouse-wheel scrolling app-wide
(Chat, Trajectory, and File all mount inside this one forked skeleton).
Fixed in the shared preset (the tag id now incorporates a hash of the full
resolved source path, not just the basename — the unconditional fix, safe
regardless of import timing) and in both packages' own fallback imports (now
lazy, so the always-on eager-evaluation trigger is gone too).

`dsh-plugins-client-ui-settings-anthropic-subscription` cannot use the
pristine-`apply()` fallback. `@deepseek-ai/dsh-client-ui-settings-models`'s
own `apply` is defined directly in its `./src/client/index.ts` — the same
file that declares its own `LocaleNamespaceMap['settings.models']` merge,
the exact key this package's own `locales.ts` deliberately widens with four
extra keys. Importing that file for its `apply` value, by any static import
form, pulls its ambient declaration into this program too, and TypeScript
rejects the resulting non-identical duplicate declaration as a compile
error. A dynamic `import()` with a non-literal specifier avoids that type
error but has no working runtime counterpart here: this package ships as a
closure-factory browser bundle (`window.__ModuleLoader__.load({id,
factory})`) with no bare-specifier or `.ts`-extension resolution for an
arbitrary module path at runtime. This plugin keeps the `priority`/
per-registration guards above; on a setup failure it logs and leaves the
Models settings section entirely absent rather than either crashing or
replaying the pristine plugin.

**Priority-based shadowing does not fully protect against a bundle
install-order violation.** It only prevents the throw `ctx.slots.register()`
itself would raise on a same-priority collision. If a `disabled: true`
operation silently fails to find its target and the pristine plugin ends up
active alongside the replacement, the pristine plugin's own unmodified
code — never designed to run twice in the same session — can still fail
some other way that priority has no bearing on (a repeated `ctx.slots.
provideRoot()` call, most concretely), and that failure is fatal to the
whole Client boot exactly like any other unguarded top-level throw. Correct
install order therefore remains a hard requirement for these bundles, not
merely a best practice: priority-based shadowing and the pristine-apply
fallback both assume, and only fully hold under, a plugin tree where the
row being replaced is genuinely absent, not merely out-shadowed.

## Package inventory

### `packages/workspace-git/` — File manager + git

| Package | Role |
|---|---|
| `dsh-plugins-api-workspace-git-controller` | Typert Host controller: status, commit-all, fetch, pull --rebase, push, discard-all |
| `dsh-plugins-api-workspace-file-controller` | Typert Host controller: list/read/write/create/diff (no delete), plus `watchDirectory`, a **workspace-scoped** directory-change stream |
| `dsh-plugins-client-ui-file-editing` | Standalone file editor/preview/side-by-side-diff components, no shared-package dependency |
| `dsh-plugins-client-ui-workspace-files` | Sidebar Files tree (live directory watch, auto-refresh toggle, reload, git status, create file/folder) and the `workspace.files` command; declares the optional `workspaceFilesNode` Context service — see "Files tree: why an optional service, not a slot" |
| `dsh-plugins-client-remotes-workspace-git` | Mounts the two controllers' generated `/remote` Client contributions — see "Plugin isolation" |
| `dsh-plugins-client-ui-workspace-enhanced` | Replaces `dsh-client-ui-workspace`'s own `sidebar.workspaces`/`conversation.hero.workspace` registrations; renders `workspaceFilesNode`'s `Component` as a Files sibling row — see "Replace, don't patch" |
| `dsh-plugins-client-ui-conversation-files` | Registers a `'file'` entry into `dsh-client-ui-conversation`'s pristine `conversation.view` slot; populated through `conversationFileOpener` — see "File tab: a pristine slot, but a fork-only trigger" |
| `dsh-plugins-client-ui-conversation-enhanced` | Replaces `dsh-client-ui-conversation`'s own conversation-shell registration; provides the `conversationFileOpener` cross-session bridge |
| `dsh-plugins-client-ui-document-host` | Replaces `dsh-client-ui-sidebar-documentpreview` by running its own `apply()` and redirecting one registration: the preview engine draws in the File tab instead of the right Sidebar. Adds the Sidebar hand-off and two renderers upstream lacks — see "Document preview: relocate the seat, never the renderers" |
| `dsh-plugins-bundle-workspace-git` | `cordis.patch.yml` bundle: does NOT mount `@deepseek-ai/dsh-workspace` itself (relies on the target profile's own `web-app` bundle — see "Two findings worth knowing" in the bundle's own README); disables and replaces the `ui-workspace`/`ui-conversation` rows |

### `packages/anthropic-subscription/` — Anthropic subscription authorization

| Package | Role |
|---|---|
| `dsh-plugins-api-authorization-controller` | Typert Host controller exposing `ctx.authorization` (list/begin/cancel/respond) as an RPC surface; mounted as an independent top-level plugin, not nested inside another service |
| `dsh-plugins-cli-login-app` | Standalone `dsh --profile <name>` application for one-shot terminal authorization — see "CLI login: why its own profile" |
| `dsh-plugins-client-remotes-anthropic-subscription` | Mounts the controller's generated `/remote` Client contribution (the `authorization` namespace) — see "Plugin isolation" |
| `dsh-plugins-client-ui-settings-anthropic-subscription` | Replaces `dsh-client-ui-settings-models`'s own `settings.section`/`settings.onboarding` registrations; adds the sign-in affordance to the Models provider editor — see "Settings UI: replacing the plugin, not patching it" |
| `dsh-plugins-bundle-anthropic-subscription` | `cordis.patch.yml` bundle: mounts `@deepseek-ai/dsh-authorization`, the controller, the Remote mount, and disables+replaces the `ui-settings-models` row |

No new package is needed for the OAuth flow itself: `@deepseek-ai/dsh-llm-pi-ai`
unconditionally registers one dormant `ctx.authorization.registerFlow()`
per installed `@earendil-works/pi-ai` catalog provider (Anthropic included)
the moment `ctx.authorization` exists in a composition. What this bundle
adds is purely surface: an RPC controller, a CLI command, and a UI panel
exposing that already-registered flow.

#### CLI login: why its own profile

`dsh-cmdline` lets any number of plugins read the launcher's argument line
and parse independently, but `@deepseek-ai/dsh-headless/startup` declares a
variadic `[task...]` positional with no grammar that rejects a
`login <key>` command — a second plugin's `login` command would fire
**alongside** it, running a real headless task using the credential key as
its literal prompt. `dsh-plugins-cli-login-app` sidesteps this by being its
own profile with no task-positional parser mounted at all:
`dsh --profile anthropic llm-pi-ai/anthropic`, no `login` verb needed since
there's nothing else to disambiguate from.

#### Settings UI: replacing the plugin, not patching it

`ui-settings-models` declares exactly two extension slots
(`settings.models.provider-card`, `settings.models.footer`), and neither
reaches inside `ProviderEditor`'s own card body, where a sign-in affordance
next to the API-key field has to render. `dsh-plugins-client-ui-settings-
anthropic-subscription` disables the original `ui-settings-models` row and
inserts a full replacement that forks only the four files that actually
change — `ModelsSection.tsx`, `ProviderEditor.tsx`, `client/index.ts`, and
`locales.ts` (four sign-in copy keys) — reusing everything else
(`CustomProviderCard`, `DeepSeekModelsEditor`, `DeepSeekOnboardingDialog`,
`WelcomeNotice`, `welcome-store`, `store`, `operations`,
`schema-operations`, `slot-contract`, `EditorFooter`, `ModelListEditor`,
`apiKey`, `ModelsSection.module.css`, `onboarding-copy`) as real values
from that package's own `./src/*` export.

#### Files tree: why an optional service, not a slot

`ui-workspace` has no child slot in `WorkspaceBrowser`'s row list for a
Files entry. A new `SlotMap` child key would work but is more machinery
than the problem needs: `dsh-client-ui-workspace` just needs one optional
UI decoration from a package that may or may not be composed in —
`packages/AGENTS.md` names the pattern for that ("Optional services use
`ctx.get(name)`"). `dsh-plugins-client-ui-workspace-files` declares
`workspaceFilesNode: WorkspaceFilesNodeService | undefined`, resolved once
via `ctx.get('workspaceFilesNode')`; `dsh-client-ui-conversation`'s
`conversationFileOpener` is the same shape of seam, provided by
`dsh-plugins-client-ui-conversation-enhanced`.

#### Replace, don't patch

The seam a replacement needs sometimes doesn't exist upstream yet
(`workspaceFilesNode` above; the sign-in affordance inside
`ProviderEditor`; the `conversationFileOpener` bridge). `cordis.patch.yml`
already provides `{id, disabled: true}` alongside `{insert: [...]}` —
ordinary composition operations, not a new mechanism: disable the row that
registers the seam-less original, insert a replacement in its place, and
let the replacement register the exact same slots the original did, plus
whatever's new. "Everything is a plugin" applies to the seam-providing side
too, not just the feature side. The replacement package reuses everything
it isn't changing — the original package's own `"./src/*": "./src/*"`
export convention makes every unchanged file a real, un-duplicated import;
only the file(s) that actually need the new behavior are forked.

A patch to `packages/_vendor/deepseek-harness/` itself, however small, is
never an acceptable alternative — see "Core principles" above. That applies
even to a patch that is never actually applied to the checked-in submodule,
only kept on file for someday proposing upstream: it still sits
uncomfortably next to "never patch the vendor," and duplicates
functionality this repo's own replacement package already provides. A
genuinely upstream-worthy idea belongs in a real PR against
`deepseek-ai/deepseek-harness`, filed from a personal fork — never as a
file kept in this repo.

#### File tab: a pristine slot, but a fork-only trigger

`dsh-client-ui-conversation`'s `conversation.view` is a real, pristine
`kind: 'list'` slot; `dsh-plugins-client-ui-conversation-files` registers a
`'file'` entry into it directly, no replacement needed for the tab itself.
What the tab *displays* is a different story: opening a file from outside
the session's own render tree (the sidebar's Files tree is the motivating
case) needs a cross-session bridge, because `ConvViewOwnerProps.openView`
is scoped to whichever session is currently mounted, and no pristine API
reaches a live per-session store instance from outside its own render tree.
`dsh-plugins-client-ui-conversation-enhanced` provides this bridge
(`conversationFileOpener`) by disabling `dsh-client-ui-conversation`'s own
row and inserting a replacement that forks `ConversationMainPanel`,
`ConversationSessionHeader`, and `DefaultConversationViews` (`InputBar` and
everything else stay unchanged; `ConversationRoot.tsx`/`ConversationSession.tsx`
are thin wrappers, in the pristine package now too, delegating to these
three). All three need forking, not just the one whose render body drains
the request: `dsh-client-ui-conversation`'s pristine `session.blank &&
conversationPhase(...) === 'blank'` Hero gate is duplicated across all
three — `ConversationMainPanel`'s `hero` computation (which also decides
the composer's docked-vs-centered layout and the width handles),
`ConversationSessionHeader`'s `hideChrome` (the title/tabs row), and
`DefaultConversationViews`'s own blank early-return (the view body) — so a
session that has never had a first turn would otherwise show a file
requested from the sidebar in a fully hidden tree, regardless of what
`openView` is told. Each fork's gate ORs in one more condition: the
session's `everOpenedFile` bit, a sticky (never reverts) per-session flag
that `FileOpenRegistry` sets the moment `conversationFileOpener.openFile`
is first called for that session. Once true, the session gets the same
active-phase layout (ordinary header, docked composer, width handles, all
tabs visible) an engaged session already has — a File preview opened before
any turn behaves exactly like one opened after.

A second consequence of the File tab holding its own opened path in
component state (the store carries only the one-shot `viewRequest`
handoff, which the tab acknowledges immediately) is that the tab cannot
restore itself. The renderer remounts a Session's whole session-scope
subtree per session id, so clicking a conversation in the sidebar
rehydrates that Session's persisted store — View selection included — and a
persisted `view: 'file'` would land on the tab's "no file opened yet"
resting notice rather than on the file that had been showing. So the fork's
`DefaultConversationViews` resets the selection to Chat once per mount, and
`apply.ts` activates that landing View instead of the persisted preference
it can no longer honour: entering a conversation always shows Chat. The one
exception is a `conversationFileOpener` request already queued for the
session being mounted — the drain effect is about to open the File view for
it, so its selection is left alone.

`dsh-plugins-client-ui-
workspace-files`'s `openFileInSession` still degrades correctly whenever
this bridge declines a request outright — no binding for the target
session, or this package installed without the File-tab package
(`dsh-plugins-client-ui-conversation-files`) — `FilesNode` falls back to its
own in-app preview modal in both cases, so the two packages remain
independently useful.

#### Document preview: relocate the seat, never the renderers

Upstream `0.1.7-rc.2` ships its own file browsing and previewing in the
right Sidebar: `ui-sidebar-files` (a file tree tab) opens
`dsh-resource://file/...` addresses, and `ui-sidebar-documentpreview` claims
them with a renderer per format — text, code, Markdown, HTML, image, PDF
(pdf.js, zoom, text layer), Office, and an interactive spreadsheet grid
(FortuneSheet). That duplicates this bundle's Files tree, and puts the
preview somewhere this bundle's own design does not want it: the tree
belongs in the left Sidebar and the preview in the conversation's main area
as the File tab, where editing, saving and side-by-side git diff already
live.

Two things about the core implementation are worth keeping rather than
competing with. Its **renderer registry is a real extension point** —
`ctx.documentPreviews.register({ id, extensions, priority, … })`, where
`priority: 'extension'` outranks every builtin, alongside three public
slots (`sidebar.right.tab.document` for bodies, `.actions` for toolbar
contributions receiving the file's `absolutePath`, `.unpreviewable` for the
empty state). And its **renderer bodies are contract components** —
`DocumentPreviewProps` plus locale and an optional store, nothing
dock-specific — published through that package's own `"./src/*"` export.

**One slot name, one declaring parent.** `ui-slots` permits exactly one
entry to declare a given child slot (`slot "x" is already declared (by …)`).
The document bodies therefore render *only* inside whichever entry declares
`sidebar.right.tab.document`, which today is the `text` tab seat, reached
through `rightbar → rightbar.session → sidebar.right.pane.tab`. That single
constraint eliminates the obvious approaches:

- **Fork the renderers into `dsh-plugins-client-ui-file-editing`.** Owning
  pdf.js, a spreadsheet grid and HTML sandboxing permanently, and gaining
  nothing from any future release. Rejected on maintenance cost alone.
- **Mirror the bodies under a second slot family.** Works, but every
  renderer must be re-registered by hand under the parallel name, so a
  renderer upstream adds is invisible here until someone notices. Rejected:
  the failure mode is silence.
- **Move the dock itself** by forking `ui-layout`'s `AppFrame`, which
  declares `rightbar`. That is the app frame — column math, drag handles,
  responsive and fullscreen behaviour — and the most release-sensitive file
  in the UI. Rejected outright; this bundle forks no frame.

What remains is to **move the seat and keep the engine**:
`dsh-plugins-client-ui-document-host` disables the `ui-sidebar-documentpreview`
row and re-runs *that package's own `apply()`* through a context shim that
re-points one registration — the top-level seat — into a parent this package
declares inside the File tab, supplying a synthesized `SidebarRightTabInfo`
(tab record, `?line=` navigation params, abort signal, `bindCommands`) in
place of the dock's. Every builtin body registers itself into the relocated
seat exactly as before, **including renderers added in future releases**,
because nothing here enumerates them. A `text` tab type stays registered for
the right Sidebar so `openResource` — which *throws* for an address no type
claims, and is how conversation file links and tool line references navigate
— still resolves, and hands off to the main-area tab.

This bundle's own editing and git then ride the same rails with no fork at
all: `FileEditor` and `SideBySideDiff` register at `priority: 'extension'`
(outranking the builtin code/Markdown viewers for editable text, which stay
one click away in the viewer switcher), and Save/Edit/Git diff/Commit
register into `sidebar.right.tab.document.actions`.

**Where it ended up.** `dsh-plugins-client-ui-document-host` holds the
redirect and the hand-off; `dsh-plugins-client-ui-conversation-files` holds
the seat, because a slot has exactly one declaring entry and that entry is
the File tab. The contract lives with the declarer
(`client-ui-conversation-files/src/document-seat.ts`), so the host registers
into it by name and imports nothing from it — deliberately: a value import
the other way would have pulled the whole preview engine into the File tab's
own bundle.

**What Phase 0 established.** The design rests on a build claim, so it was
tested before anything else was written (`packages/workspace-git/
client-ui-document-host/README.md` has the full table). The engine bundles
out of tree at 287.10 kB against the vendor's own 280.79 kB for the same
graph; its heavy bodies stay lazy at 7.11 MB (`client.pdf.js`) and 7.05 MB
(`client.excel.js`), matching the vendor's artifacts; the generated requires
are rewritten to `require.async(...)`; `__DSH_PDFJS_ASSETS__` is fully
substituted; and the bundled pdf.js and spreadsheet license notices are
emitted into the chunks that carry that code.

**The maintenance surface is a build config, not a component tree.** Zero
renderer code is owned here. What is owned is `client-ui-document-host`'s
own `tsdown.config.ts`: the pdf worker embedded as source text (a closure
factory has no module URL to resolve a `Worker` file against), the
`__DSH_PDFJS_ASSETS__` define, the Excel worker sub-rolled to an IIFE
string, and two license banners. Every one of those resolves from the
**vendor package's** directory rather than this one, so `pdfjs-dist`,
`exceljs` and `xlsx` cannot drift to a second copy of a library whose build
output is embedded verbatim. A pin bump that renames one of those raw
specifiers stops the build rather than shipping a dead renderer.

**The Host half is replaced too, not just the browser one.**
`ui-sidebar-documentpreview` is a Client package with a Host half: it pushes
`__DSH_DOCUMENT_PREVIEW_CONFIG__` into the served page through
`webserver/index-inject`, and that global is where the browser engine reads
its office/excel cache limits. Disabling the row switches that off as well,
so a no-op `.` export here would have pinned those limits to their schema
defaults with no way to configure them — a replacement registering strictly
less than what it replaced, which Article III forbids. So
`client-ui-document-host`'s `.` entry re-exports the vendor's own `apply`
and `Config` unchanged. Only the settings key moves: a profile configures
`document-host` where it used to configure `ui-sidebar-documentpreview`.
Verify it the way it was verified here — boot, fetch the page, and look for
the global in the HTML, rather than trusting that the row loaded.

#### File tab controls: one toolbar, two mount points

Relocating the engine into the File tab left the file with two rows of
controls: the tab's own header (path, View/Edit/Diff, Save) above the
engine's header (its `PathLabel`, viewer picker, wrap, reload). Upstream
already declares the seam for merging them —
`sidebar.right.tab.document.actions`, a list slot for "contributions acting
on the previewed file" — so the tab's controls register into it and the
engine's header carries them.

They cannot live *only* there. That toolbar is drawn by the engine's body,
which is mounted only in View mode; controls registered into that slot and
nowhere else would vanish the moment Edit was pressed, stranding the reader
in a mode with no way back. So `FileActions` has two mount points — the
engine's toolbar while the engine draws, the tab's own header when it does
not — and the tab draws its header row only in that second case, since the
engine's header already carries the path. The engine mount claims the
controls while mounted; the tab watches that claim.

That second mount is also the fallback, not a degraded path: `slots.inject`
never fires where nothing declares the slot, so a composition without
`client-ui-document-host` keeps the tab header exactly as it was before any
of this.

**`FileView` keeps owning the state.** The draft cache, the `writeFile`
version guard and the conflict notice stay in the tab; relocating them into
a toolbar entry would have meant duplicating them. It publishes a flat
snapshot into a per-session `FileModeStore` that both mounts read, and the
store compares before notifying, so publishing on every render does not
re-render the toolbar on every keystroke. Edit is offered for whatever
`isTextKind` admits — Markdown, ontology, delimited and RTF included —
rather than an enumeration that would silently omit a kind added later.


### `packages/mcp-connector/` — MCP connectors with OAuth 2.0

| Package | Role |
|---|---|
| `dsh-plugins-mcp-client-oauth` | A superset of `@deepseek-ai/dsh-mcp-client`: the same stdio and static-header Streamable HTTP transports with identical config fields, defaults, reconnect policy, `serverName` reservation and model-facing tool names, plus a `streamable-http-oauth` transport that hands the MCP SDK an `OAuthClientProvider` backed by `ctx.credentials` and driven through `ctx.authorization` |
| `dsh-plugins-mcp-connector-registry` | The durable `mcp-connector` settings section and a live mount reconciler; publishes `ctx.mcpConnectors` |
| `dsh-plugins-api-mcp-connector-controller` | Typert Host controller: the `mcpConnectors` Remote namespace, with its own notice/prompt stream |
| `dsh-plugins-client-remotes-mcp-connector` | Mounts that namespace's generated Client contribution — see "Plugin isolation" |
| `dsh-plugins-client-ui-settings-mcp-connector` | Settings > MCP connectors; an *additive* `settings.section` registration, so no vendor row is disabled |
| `dsh-plugins-host-oauth-callback-mcp-connector` | `/mcp-oauth/callback` on the web server for a browser that cannot reach the host's loopback listener; publishes the optional `ctx.mcpOAuthCallbacks` sink, and registers its route through a nested `webServer` inject so a CLI profile mounts it harmlessly |
| `dsh-plugins-cli-mcp-connector` | Standalone `dsh --profile mcp <command>` CLI — `add`/`list`/`set`/`login`/`logout`/`remove`/`status`/`clone-grant`, plus `secret set|status|unset` for the credentials an stdio connector's `envFrom` names; every command `--json` so an agent can drive it |
| `dsh-plugins-bundle-mcp-connector` | `cordis.patch.yml` bundle: the registry, the controller, the callback route, the Remote mount, and the Settings page |

#### Why this bundle exists at all

`@deepseek-ai/dsh-mcp-client` at pin `0d1f5000` offers exactly two
authentication shapes — a spawned stdio child with env vars, or a Streamable
HTTP URL with a *static* `headers` dictionary. Its transport factory builds
`StreamableHTTPClientTransport` with `{ requestInit: { headers } }` and passes
no `authProvider`, so there is no authorization-code leg and no refresh
anywhere in the package. A static header cannot carry a token that expires
hourly, which is what every OAuth-gated remote MCP server issues — Google's
official Gmail and Drive MCP servers among them. Both publish RFC 9728
metadata naming `https://accounts.google.com/` as their authorization server,
and that server publishes no `registration_endpoint`, so Dynamic Client
Registration is unavailable and a hand-registered client id *and secret* are
mandatory. That last fact is why the client pair is stored in the credential
record rather than assumed to be mintable — though a server that *can* mint one
is supported too, and covered under "Sign-in is not gated on a stored client"
below.

#### Secrets a stdio server needs

A stdio MCP server that authenticates with an API token needs it in the child
environment, and the definition's `env` is the wrong place: definitions live in
the settings document, which this bundle promises is safe to read, print, diff,
and copy. So a definition names the credential instead of carrying it —
`envFrom` maps a child variable to a *credential reference*, resolved once per
mount through `ctx.credentials`, whose local provider layers the process
environment over `$DSH_HOME/.credentials.yaml` over the `.env` fallbacks.

Naming it is also the only way it arrives. The subprocess seam scrubs every
ambient name matching `/KEY|PASSWORD|SECRET|TOKEN/i` out of a spawned child, so
a token merely exported in the parent shell never reaches the server unless a
connector asks for it. `buildClientConfig` stays pure and secret-free because
it is both the `put`-time validation and the mount signature — a signature is
compared, retained, and read by a human debugging a reconcile. Resolution
happens separately, at mount, and an unresolved reference fails that one
connector's mount naming every missing credential rather than starting the
server unauthenticated to fail every tool call later with a 401.

#### Sign-in is not gated on a stored client

Both surfaces once refused to *start* a sign-in while no OAuth client was
stored — a disabled button, and a CLI error naming the `set --client-id`
command. That reads as correct only from where this bundle was written:
Google's authorization server publishes no `registration_endpoint`, so there a
hand-registered client really is a precondition.

It is not one in general. A server publishing an RFC 7591 registration endpoint
has no client to configure and mints one *during* the attempt, which is what
`McpOAuthProvider.saveClientInformation` exists to persist, and the pre-flight
refusal made every such server unreachable from both surfaces at once —
including Atlassian's `https://mcp.atlassian.com/v1/mcp`, whose client cannot
be created by hand anywhere, because that host is its own authorization server.

So the diagnosis moved after the attempt, where the SDK has said which kind of
server this is: `registerClient` throws "Incompatible auth server: does not
support dynamic client registration" in exactly the case a hand-made client
answers. `signInFailure` in `connector-registry` turns that one failure — and
no other — into advice naming both the Settings field and the CLI command, and
both surfaces render that single string. The Remote controller returns the
original error untouched when the diagnosis does not apply, because its
`failure()` mapper switches on error *type*: rewrapping an `AuthorizationError`
in a plain `Error` would turn a `mcp-connectors/rejected` into a
`gateway/internal` and lose the code the page branches on.

Behind that gate sat a second failure worth recording, because its symptom
named nothing actionable. `auth()` calls `saveDiscoveryState` with
`resourceMetadata` and `resourceMetadataUrl` present-but-`undefined` whenever a
server publishes no RFC 9728 document, and the credential seam's
`assertJsonValue` walks nested values and refuses `undefined` anywhere, while
`McpOAuthStore.merge` stripped it only from the grant's own top level — the
level the SDK's object never occupies. Every sign-in to such a server died on
the first write with "payload holds a value JSON cannot represent". The strip
is now recursive, and drops `undefined` only: a `Date` or a non-finite number
is a real mistake about what a record holds and stays refused rather than
quietly laundered into storage.

#### One authorization request per attempt

A sign-in must ask for exactly one URL. The mount keeps retrying underneath a
pending attempt, each retry is answered `401`, and each `401` drives `auth()`
again — which mints a new PKCE pair and stores it over the previous one. The
human is still looking at the first URL, so by the time they open it the stored
verifier belongs to a later round and the redemption fails with `Invalid PKCE
code_verifier`, an error naming nothing that was actually wrong. Against
Atlassian's server one attempt produced six URLs and six challenges under a
single `state`. `McpOAuthProvider.issuedFor` closes it: the first redirect of an
attempt wins, later ones are dropped, and a new attempt issues afresh.

#### What is forked, and why it is not a "replacement"

This bundle disables no vendor plugin row, so CONSTITUTION.md Article III's
superset obligation does not apply to it — but it does fork two vendor *files*
(`mcp-client`'s `connection.ts` and `transport.ts`) and reimplement two more
(`tools.ts`'s name/sync halves as `tool-bridge.ts`, and `server-context.ts`).
The fork is minimal by construction: `createTransport` is reached through a
plain relative import that no configuration seam can redirect, so adding a
transport case means owning the file that calls it. The supervision logic
inside `connection.ts` is the vendor's, unchanged, with three marked fork
points.

`tool-bridge.ts` is a reimplementation rather than an import because the vendor
keeps `publicToolName`/`syncTools` behind its `./src/*` export, and a `./src/*`
import resolves to a raw `.ts` file plain Node ESM cannot load — a Host package
cannot do what this repo's browser-bundled Client packages do with that same
export. Everything difficult (`createMcpToolDefinition`) is imported as a real
value from the vendor's package entry.

Those four files are recorded in `scripts/replacement-parity.json`'s new
`forkOnly` array. Checks 1-4 have nothing to judge for a package that replaces
no row; check 5 — the fork-hash check that forces the by-hand re-read — runs
over them exactly as it does for the three real replacements.

#### `@deepseek-ai/dsh-mcp-client` is not disabled

It is not a bundle row this repo replaces: a profile instantiates it *once per
MCP server* through its own `cordis.patch.yml` rows, and disabling it would
take those servers down. The two plugins coexist; because the config field
names and derived tool names are identical, migrating one server across is a
one-word `name:` edit. The one hazard is the same `serverName` live on both at
once — each keeps its own namespace reservation, so the duplicate is caught not
by that guard but later by `ctx.tools.register`, which refuses the duplicate
public name and rolls that server's whole tool generation back with a logged
error.

#### Reserved Remote method names

The Client gateway installs every Remote method as a property of its namespace
*service* and refuses a name shadowing one of that service's own members:
`ctx`, `empty`, `invokeRemote`, `methods`, `name`, `namespace`, plus
`RemoteNamespaceService`'s own `assertMethodAvailable`, `has`, `install`,
`installDirect`, `installScoped`, and `remove`. Nothing catches a collision
until a browser boots — the Host mounts fine, the Client `$mount` throws
`client api: method "…/remove" conflicts with its namespace service`, the
mounting plugin catches and logs it per "Plugin isolation", and the only
visible symptom is a settings page that never appears. This bundle's delete
operation is therefore `removeConnector`. Check any new `@Remote` method name
against that list.

#### Where the browser redirect lands

A sign-in needs the authorization server's redirect to reach the process that
minted the request's `state`. The default is a loopback listener bound on the
`dsh` host for the duration of one attempt — nothing extra mounted, nothing
reachable from off the box — and it is exactly right while the human's browser
runs on that host. It is useless when the browser is elsewhere (a `dsh` over
SSH, the web UI opened from a laptop), because that browser resolves
`127.0.0.1` to its own machine. The paste-the-URL prompt has always covered
that case, at the cost of a human copying a URL with an authorization code in
it out of one window into another.

`dsh-plugins-host-oauth-callback-mcp-connector` adds a third delivery: the web
server that is already serving the UI answers `/mcp-oauth/callback`. Which
deliveries run is decided by the connector's own redirect URI rather than by
configuration — loopback URI, loopback listener; a URI whose path is the
route's, the web sink; the paste prompt races either, always.

The seam points the unusual way round on purpose. `McpOAuthCallbackSink` and
its `ctx.mcpOAuthCallbacks` Context merge are declared in
`dsh-plugins-mcp-client-oauth`, the *consumer*, not in the package that
implements it. The consumer must compile and run in a profile with no web
server at all — the CLI's own profile has none — so it can hold the contract
but never the dependency, and reads the sink with `ctx.get(...)` rather than
an `inject` that would strand it. The implementing plugin inverts the same
rule for its route: it publishes the service unconditionally and requires
`webServer` through a nested `ctx.inject`, because a top-level requirement
would leave the entry pending forever in a CLI profile, which this repo's boot
treats as fatal to the whole application rather than to one feature
(CONSTITUTION.md Article V).

#### Typert generation and `tsconfig.host.json`

The generator names a wire-crossing type through its declaring package's export
map, and resolves that only for packages listed **top-level** in
`tsconfig.host.json`; for anything else it emits a bare name with no import
(harmless, and already the case for `dsh-plugins-api-authorization-controller`'s
own `AuthorizationEntry`/`CredentialKey`). Listing `connector-registry` and
`mcp-client-oauth` there made the generator crash outright —
`getExportsOfModule` on an undefined module symbol — while resolving a type
whose sources were not in the filtered program, so neither is listed; both are
still typechecked and built through `api-mcp-connector-controller`'s own
project references. For the same naming reason, a `@Remote` signature must not
use a mapped type (`Partial<T>`) or an anonymous object literal; declare a
named interface.

### `packages/terminal/` — Bottom terminal panel

| Package | Role |
|---|---|
| `dsh-plugin-terminal` | In-repo fork of the third-party npm package `dsh-plugin-terminal`: a `node-pty`-backed, multi-tab bottom terminal panel for the Web GUI. `cordis.patch.yml` only *inserts* (`terminal-panel`), unlike the other two bundles — it disables nothing, so it has no install-order dependency on `dsh-web-app` having already mounted anything. |

Unlike the other two bundles, this one is not this repo's own design —
it's an unmodified copy of the upstream `0.1.13` npm tarball except for
`src/index.js` and `package.json`. The fork exists because a security
review found the upstream plugin's own `ctx.webServer` routes (session
list/create/input, plus the WS PTY stream) had no authentication of their
own — a hand-rolled `Origin`-header check trusted any request with no
`Origin` header at all, giving any local, unauthenticated caller full shell
access as the logged-in user. Fixed by routing through
`ctx.connection.requestRejection(req)`, the same Host/Origin fence and
signed-cookie check every other route in a `dsh-web-app`-based composition
already goes through — see `packages/terminal/dsh-plugin-terminal/README.md`
for the full writeup, including the separate `node-pty` prebuild fix and
the live-server verification. `packages/_vendor/deepseek-harness` was read
to find the `ctx.connection` primitive to reuse, never edited.

## Replacement parity

Three of this repo's packages do not extend the vendored harness — they
*replace* one of its plugin rows. The bundle's `cordis.patch.yml` sets
`disabled: true` on a vendor row and inserts an out-of-tree package in its
place:

| Disabled vendor row | Vendor plugin | Replacement | Declared in |
|---|---|---|---|
| `ui-workspace` | `@deepseek-ai/dsh-client-ui-workspace` | `dsh-plugins-client-ui-workspace-enhanced` | `bundle-workspace-git/cordis.patch.yml` |
| `ui-conversation` | `@deepseek-ai/dsh-client-ui-conversation` | `dsh-plugins-client-ui-conversation-enhanced` | `bundle-workspace-git/cordis.patch.yml` |
| `ui-settings-models` | `@deepseek-ai/dsh-client-ui-settings-models` | `dsh-plugins-client-ui-settings-anthropic-subscription` | `bundle-anthropic-subscription/cordis.patch.yml` |

Nothing else here disables a vendor row: `packages/terminal/` only inserts,
and every other package in the two bundles registers into a pristine slot
that already exists.

**A disabled row contributes nothing at all.** Not "nothing new" — nothing:
its slot registrations, its provided services, its locale dictionary, its
config schema, and every component it renders all disappear with it. So the
question a replacement has to answer is never "what did we add", it is
"what did the row we switched off do, and do we do all of it". Anything
missed is a regression the user experiences as *installing this repo's
bundle removed a feature* — which is what Core principle 3 and
[`CONSTITUTION.md`](CONSTITUTION.md) Article III forbid.

A vendor pin bump is where that goes wrong quietly. Upstream adds a slot, a
locale key, a config field, or reshapes a component this repo forked; the
replacement keeps registering last release's surface; and `tsc -b` stays
green the whole time, because the replacement is perfectly type-correct —
it is just *less* than the thing it replaced.

### What parity means, check by check

`scripts/replacement-parity.json` declares each replacement above — the row
it disables, the vendor plugin's apply entry, its own apply entry, its
forked files, what it deliberately adds, and what it deliberately does
differently. `pnpm run check:parity` reads it and enforces six things:

1. **Row.** The bundle patch really disables that row id and really inserts
   the replacement, *and that row id still exists in a vendored bundle*. An
   upstream rename turns `disabled: true` into a silent no-op, which is
   worse than an error: the pristine plugin and the replacement then both
   register the same slots, and the composition dies on a duplicate
   registration (or, at `priority: -1`, quietly renders the wrong one — see
   "Replaced-plugin resilience").
2. **Inject.** The replacement's `inject` array covers the vendor plugin's,
   so it cannot activate in a composition the original would have refused.
3. **Slots.** Every slot `name:`/entry `id:` the vendor apply registers is
   registered by the replacement's apply too.
4. **Locale.** A forked copy dictionary is a superset of the vendor
   dictionary it stands in for, key for key, in both `en` and `zh`.
5. **Forks.** Every vendor file this repo forked still hashes to the
   revision the fork was last synced against.
6. **Retired rows.** A row this repo switches off with *nothing* inserted in
   its place is declared under `retirements` instead, and answers the
   questions that still have answers: the disable is real, the row still
   exists upstream (same no-op trap as check 1), the entry names the surface
   that now carries the capability (`covers`), and it names what was given
   up (`divergences`, which may not be empty — a disabled row always costs
   something, at minimum its own entry point). Checks 2-4 are skipped for
   these, because there is no replacement plugin to compare against; that is
   what makes the entry's own prose the record, and why the check insists it
   exists. `ui-sidebar-files` is the first: see "Document preview: relocate
   the seat, never the renderers".

Check 5 is the one that carries the weight. The first four are textual and
cannot prove a forked React component still renders every branch the
original did — no regex can. What check 5 does instead is refuse to go green
while a forked file's original has moved, which forces the diff-by-hand that
actually finds the missing branch. Clear it only by re-reading the vendor
file beside the fork, porting what changed, and then recording the new hash:

```sh
pnpm run check:parity                      # red: names each moved original
# ... re-fork the named files by hand ...
node scripts/check-replacement-parity.mjs --update   # re-record the hashes
```

`--update` is not a way to make a red check green. Running it without having
actually re-forked the files is how the regression this whole section exists
to prevent gets committed with a passing check next to it.

`--update` re-records the fork hashes but deliberately leaves `vendorPin`
alone — that one is set by hand, to the commit the files were read from.
Forgetting it used to be silent. It is not any more: `pnpm run check:vendor`
compares `vendorPin` against the submodule commit the index would record and
fails while they disagree, and the `pre-commit` hook runs it, so a pin bump
whose parity file still points at the previous release cannot land.

The check reads the vendored submodule, so run it from the primary checkout
— or, from a worktree that has no submodule checkout of its own, pass
`--root <path to the primary checkout>`. It exits telling you so rather than
reporting a dozen phantom "missing file" failures.

### Diffing a fork against its vendor original

The mechanical form of the by-hand read is "show me every line the vendor
file has that the fork doesn't", which for a well-maintained fork should be
nothing but the lines the fork deliberately rewrote — its own doc comment,
its repointed imports, and its changed signatures:

```sh
diff -u packages/_vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx \
        packages/workspace-git/client-ui-conversation-enhanced/src/ConversationMainPanel.tsx \
  | grep '^-' | grep -v '^---'
```

Every surviving line has to be explainable as an intentional fork edit. A
line you cannot explain is upstream behaviour the fork dropped.

### Recorded divergences

A replacement may deliberately differ from the row it replaces, but only on
the record — in the manifest's `divergences`, with the reason — so the next
reader can tell an intent from an omission. As of vendor pin `0d1f5000`
there are two:

- **`ui-conversation`** — entering a conversation activates the landing View
  (Chat) rather than the Session's persisted View preference. The forked
  File view holds its opened path in component state and cannot restore
  itself across the per-session remount, so a persisted `view: 'file'` would
  land on an empty "no file opened yet" notice. See "File tab: a pristine
  slot, but a fork-only trigger".
- **`ui-settings-models`** — its `apply()` does not fall back to the
  pristine plugin's `apply()` on setup failure, the way the other two
  replacements do. Importing that file for its `apply` value also pulls in
  its own narrower `LocaleNamespaceMap` declaration, which conflicts with
  this package's wider one at compile time; see that package's
  `src/client/index.ts` doc comment for why no import form avoids it.

## Testing procedures

Two things need testing for any plugin change in this repo: the ordinary
install path, and the failure path. A change that touches a replacement
package or the submodule pin needs "Replacement parity" above as well.

### Test `dsh plugin add`/`remove` on a disposable profile

Never run `dsh plugin --profile <name> add`/`remove` against a profile a
real session is actively using. Clone the profile into a scratch name
first:

```sh
ditto ~/.dsh/profiles/web ~/.dsh/profiles/web-verify
```

(macOS; handles the symlink-heavy pnpm `node_modules` tree correctly —
plain `cp -r` fails with repeated "directory causes a cycle" errors.)

Then, from `packages/_vendor/deepseek-harness` (`node --import tsx/esm
apps/cli/src/bin.ts <args>` is more reliable here than `pnpm run dsh --
<args>` for a `--profile` flag):

```sh
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web-verify \
  remove dsh-plugins-bundle-anthropic-subscription
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web-verify \
  add /absolute/path/to/packages/anthropic-subscription/bundle-anthropic-subscription
cat ~/.dsh/profiles/web-verify/package.json   # confirm dsh.profile.bundles
                                               # reconciled correctly
node --import tsx/esm apps/cli/src/bin.ts --profile web-verify \
  --port 0 --no-open                          # port 0: an OS-assigned free
                                               # port never collides with a
                                               # live session's own port
```

Open the printed `http://127.0.0.1:<port>/?token=...` URL, confirm the
feature actually renders (`document.body.innerText` on the loaded page is
a reliable, scriptable check that doesn't rely on screenshots), then `kill`
the process and `rm -rf ~/.dsh/profiles/web-verify`.

### Fault-inject a plugin to prove `dsh` survives it

Passing typecheck and a happy-path boot proves nothing about "a plugin's
failure must never take down `dsh`" — only a deliberate failure does.
Patch the **built** output (never the committed source) of the plugin
under test to fail, backing up the file first:

```sh
cp packages/<group>/<package>/lib/client.js /tmp/client.js.bak
# edit lib/client.js: make its apply() throw, e.g. replace the first line
# of the function body with: throw new Error('SIMULATED FAILURE: ...')
```

Reboot against the disposable test profile above. A plugin that correctly
contains its own failures leaves the rest of the app — the settings page
it contributes to, the sidebar section nearby, whatever else shares the
same boot — rendering and working exactly as it does without the fault;
the only visible effect is the broken plugin's own log line and, if
applicable, one absent feature. A plugin that doesn't contain its failure
produces a blank "HARNESS / Failed to load plugins" page for the entire
app instead.

Restore the backed-up file and confirm a fresh `tsdown` build of the same
package produces byte-identical output (`diff`) before considering the
test clean — the built artifact must carry zero trace of the injected
fault once done.

### Check for colliding style-tag ids after touching a fork+fallback package

The incident in "Replaced-plugin resilience" above (a fork's own CSS
silently losing its `<style data-plugin-css>` tag to vendor's same-named
CSS Module) passed every other check in this file — clean `tsc -b`, clean
`pnpm run build`, a well-formed `--dump-config` tree — because none of them
inspect the *content* of the built stylesheet injectors, only whether the
bundler and type checker are satisfied. `styleInjectionModule`'s tag id now
incorporates a hash of the resolved source path specifically so this class
of collision can't recur, but if that guard is ever touched again, or a new
package adds another CSS Module with the same basename as one it forks,
this is the check that catches it — a real boot and browser click-through
would eventually surface it too (as broken layout, not a crash), but this
is faster, needs no browser, and pinpoints the exact colliding basename
instead of leaving you to reverse-engineer it from broken CSS:

```sh
grep -o '[a-zA-Z0-9_-]*/[a-f0-9]\{8\}-[A-Za-z]*\.module\.css' \
  packages/<group>/<package>/lib/client.js | sort | uniq -c
```

Run against `client-ui-workspace-enhanced/lib/client.js` today, this lists
one line per CSS Module the bundle carries, each with its own hash prefix:

```
   1 dsh-plugins-client-ui-workspace-enhanced/095dd4a7-WorkspaceBrowser.module.css
   1 dsh-plugins-client-ui-workspace-enhanced/d1c85a3e-WorkspacePicker.module.css
   1 dsh-plugins-client-ui-workspace-enhanced/dff3dc91-WorkspaceBrowser.module.css
   1 dsh-plugins-client-ui-workspace-enhanced/f137afbc-Rows.module.css
```

`WorkspaceBrowser.module.css` legitimately appears **twice** here — once
for this package's own local-copy fork, once for vendor's own file, pulled
in through the lazy pristine-`apply` fallback — and that's correct: two
different source files sharing a basename, two different hashes, two real
tag ids, both stylesheets actually reach the DOM. The bug this check would
have caught looked different: only **one** entry for
`WorkspaceBrowser.module.css` despite two source files owning that
basename, because the pre-fix tag id was the basename alone (no hash),
so the second file's injection saw a tag that already existed and
silently no-opped. If you ever see a CSS Module basename you know two
packages both own (a fork and the vendor file it forks) show up only
once in this listing, one of them lost that race and its rules never
reach the DOM.

`client-ui-conversation-enhanced` no longer fits this same shape, and
that's deliberate, not a regression: its own `ConversationMainPanel.tsx`/
`ConversationSession.tsx`/`DefaultConversationViews.tsx` import
`ConversationRoot.module.css` **cross-package** (from
`@deepseek-ai/dsh-client-ui-conversation`'s own `./src/*` export) rather
than keeping a local copy, because vendor's own upstream split
(`ConversationMainPanel`/`ConversationContent`/`DefaultConversationViews`,
formerly one file) now shares that one CSS Module across this fork's own
components *and* a reused-unchanged vendor component
(`ConversationContent.tsx`) in the very same bundle — a local copy would
give the two halves of one rendered subtree two different compiled scopes,
silently breaking every compound selector between them (`.root[data-phase=
'active'] .viewArea`, most concretely). Run the same `grep` against
`client-ui-conversation-enhanced/lib/client.js` and `ConversationRoot.
module.css` now appears exactly **once**, even though both this fork and
the reused `ConversationContent.tsx` (and, if the pristine-`apply` fallback
ever fires, vendor's own `ConversationRoot.tsx`/`ConversationMainPanel.tsx`
too) all reference it: the bundler de-duplicates by *resolved absolute
path*, and a bare cross-package specifier resolves to the identical
absolute file a sibling's relative import does, so all three land in one
module instead of two or three. Don't read a *single* entry for that one
basename in this specific package's bundle as a collision — confirm
first whether the package genuinely still keeps a local copy (`git status`
/ `ls src/*.module.css`) before treating this check's "only one entry"
signal as a bug here.

### What each check catches

| Check | Catches |
|---|---|
| `tsc -b` (package + `tsconfig.client.json` full aggregate) | Type errors, including ones only visible once a package is wired into the whole client program |
| `pnpm run build` (host then client, per group) | Bundler-level failures — a cross-package import the purity gate rejects, a CSS Modules specifier the resolver can't follow, a Typert generator mismatch |
| `--dump-config` | Whether the composed `cordis.yml` tree is well-formed. Does *not* by itself confirm a disable/insert row resolved against something real — a `disabled: true` targeting a row that doesn't exist yet prints a non-fatal "entry not found" instead of erroring loud; read the printed tree |
| A real boot + `--dump-config` together | The install-order dependency between bundles (a `disabled: true` needs the row it targets already inserted by an earlier bundle) |
| A real boot + real browser DOM interaction | Whether the feature actually renders and functions — a served bundle manifest is necessary but not sufficient. Does *not* by itself explain a mis-styled-but-present feature: two packages' components can both render correctly while only one's CSS actually reaches the DOM (see "Check for colliding style-tag ids" above) — a rendering bug that presents as broken *layout*, not a crash, is easy to blame on the wrong file if you skip straight to reading component logic |
| Colliding style-tag ids (above) | A fork's own CSS Module silently losing its injection race against a same-named vendor CSS Module reached through a fallback import — passes `tsc -b`, `pnpm run build`, and `--dump-config` alike, and requires reading the *built* bundle's content, not just its existence, to catch |
| Fault injection | Whether a plugin failing takes the rest of `dsh` down with it — no other check exercises this |
| `pnpm run check:vendor` | A modified vendor submodule (Article II), in either of its two shapes: a dirty vendor working tree, and a submodule pin that has moved away from `vendorPin` in `scripts/replacement-parity.json` — the second being what a commit made *inside* the submodule looks like, since it leaves the vendor's own `status` clean. Runs from the `pre-commit` hook, so it catches these before they land rather than after. Note it deliberately *skips* the working-tree half where the submodule is not checked out (a plain `git worktree add` does not populate submodules) — a vendor that is not on disk cannot have been edited, and the pin half still runs there because it reads the index |
| `pnpm run check:parity` (retired rows) | A row switched off with nothing put in its place whose upstream row id has since been renamed — the same silent no-op as a replacement's, but with no replacement plugin whose duplicate registration would make the problem loud. Also refuses an entry that does not say what now covers the capability, or claims the removal cost nothing |
| `pnpm run check:parity` | A replacement that no longer covers the vendor row it disables — a slot, entry id, injected service or locale key the original registered and it doesn't; a disabled row id upstream renamed out from under it; a forked file whose vendor original has moved since the fork was last synced. Every one of these passes `tsc -b` and `pnpm run build` unnoticed, because a replacement that silently dropped a feature is still perfectly type-correct |

## Explicitly out of scope

`packages/shell/tool-bash`'s workdir-escape-preflight fix is a genuine
upstream bug fix unrelated to either feature here. It belongs in its own
PR against `deepseek-ai/deepseek-harness`.

## Open items

- **Consolidating with the upstream Sidebar file browsing and preview**
  (see "Document preview: relocate the seat, never the renderers"), staged
  so each step is usable and reviewable on its own:
  1. ~~*Left tree absorbs the core tree.*~~ **Done.** `FilesNode` gained live
     per-directory watching, the auto-refresh pause/resume toggle, reload,
     per-directory failure lines, directories-first natural order and the
     shared `FileTypeIcon` glyphs; `workspace-files.watchDirectory` was added
     to `dsh-plugins-api-workspace-file-controller` as a **workspace-scoped**
     stream (reusing `@deepseek-ai/dsh-api-workspace-files`'s own
     `WorkspaceChangeFeed` through its `./src/*` export) so the tree still
     watches with **no Session started**, which the Session-scoped core tree
     cannot. The `ui-sidebar-files` row is disabled, `workspace.files` (Cmd+P)
     re-registered against the left tree, and the whole trade recorded under
     `retirements` in `scripts/replacement-parity.json`.
  2. ~~*Relocate the preview engine*~~ **Done.** `dsh-plugins-client-ui-
     document-host` replaces the `ui-sidebar-documentpreview` row by running
     that plugin's own `apply()` through `relocatingContext`, which redirects
     the seat registration into `conversation.file.document` — the slot
     `dsh-plugins-client-ui-conversation-files` declares in the File tab and
     answers `useTabInfo()` for. The vacated Sidebar seat now holds a
     hand-off body, so `openResource` still resolves and forwards the file to
     the middle.
  3. **Partly done.** The two formats upstream genuinely lacks — OWL/RDF
     ontologies and `.rtf` — are registered into `ctx.documentPreviews` at
     the `extension` band. Editing, saving and side-by-side git diff stay in
     the File tab's own header rather than moving into
     `sidebar.right.tab.document.actions`: with the preview now in the middle
     beside them, that slot would move controls *away* from where the reader
     already is. Still open: `FileView` keeps its own read of the file (the
     Edit and Diff modes need the text anyway), so a previewed file is read
     twice — once by the tab, once by the engine.
  4. *Parity and proof*: fork hashes and divergence records, `check:vendor`,
     `check:parity`, typecheck, build, and the real-boot pass below.
  5. Afterwards and separately: relocate the **core** terminal
     (`ui-sidebar-terminal` — shell picker, process recovery across reload,
     tab rename, completion) into the bottom-panel position
     `packages/terminal/` occupies today, using the same seat-relocation
     kit, and retire that fork once it is proven at parity.
- **The document host has not been watched rendering in a browser.** What
  *has* been checked, on a disposable profile cloned per "Test `dsh plugin
  add`/`remove`" below: the composed profile boots with no activation
  warning; the served boot manifest carries `dsh-plugins-client-ui-document-
  host` and no longer carries the two disabled rows; the entry bundle it
  serves asks for both lazy chunks through `require.async`; and the server
  serves `client.pdf.js` (7.11 MB) and `client.excel.js` (7.05 MB) on
  demand, each registering itself under its own `chunk:` name. What remains
  is the one thing HTTP cannot answer — that a PDF, a spreadsheet and an
  image actually draw in the File tab.
- **A previewed file is read twice.** `FileView` keeps its own read (Edit
  and Diff need the text regardless), and the relocated engine performs its
  own paged read of the same file. Harmless but wasteful; collapsing them
  means the tab taking its text from the document owner's content, which is
  a bigger change than Phase 3 was worth.
- **Bundle install order.** `scripts/install-plugins.mjs`'s `BUNDLES` array
  is where this order is now written down and applied (`pnpm run build`
  runs it; it appends only what a profile is missing, and warns rather than
  reshuffles when an existing profile's order disagrees). The constraint
  itself is unchanged: `dsh-plugins-bundle-workspace-git`'s
  `disabled: true` rows for `ui-workspace` and `ui-conversation`, and
  `dsh-plugins-bundle-anthropic-subscription`'s for `ui-settings-models`,
  only resolve if whatever bundle mounts those rows (`@deepseek-ai/
  dsh-web-app`) is already in `dsh.profile.bundles` *before* the replacing
  bundle — `cordis.patch.yml` operations apply in list order. For a profile
  name `dsh` auto-initializes from a shipped template (`web`, `headless`,
  `acp`, `sdk`, `sdk-minimal`), the template already includes
  `dsh-web-app`/`dsh-base` before the first `plugin add` runs, so this is
  automatic; a profile under any other name needs the bundle that mounts
  those rows added explicitly first.
- Confirm whether `dsh-plugins-api-workspace-git-controller` and
  `-file-controller` should merge into one controller package — they're
  split by concern (git vs. generic file CRUD) but share no code.
- Confirm whether `packages/api/remotes` and `packages/api/session-controller`
  need any additive registration for Typert's auto-discovery, or whether
  zero such edits is genuinely sufficient going forward.
