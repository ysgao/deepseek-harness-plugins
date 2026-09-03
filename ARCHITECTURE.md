# Architecture

This repo hosts two independent, **out-of-tree** `dsh` plugin bundles:

1. **`packages/workspace-git/`** — the File manager sidebar (file tree,
   preview, in-app edit, side-by-side git diff) and its git status/commit
   /fetch/pull-rebase/push actions.
2. **`packages/anthropic-subscription/`** — Anthropic subscription
   authorization, in the CLI and in the Models settings UI.

Neither bundle patches, copies, or forks any file under
`packages/_vendor/deepseek-harness/`. Every package here either *depends
on* a seam the vendor already publishes (a Typert-registered Host
controller auto-discovered by `dsh-typert-loader`, `dsh-cmdline`'s
multi-plugin argument parsing, an existing `SlotMap` extension point), or —
where no such seam exists — *replaces* one existing plugin registration
wholesale with an enhanced out-of-tree one (see "Replace, don't patch").
Installation is always `dsh plugin --profile <name> add <package>` (see
`packages/_vendor/deepseek-harness/packages/bundle/README.md`).

## Core principles

1. **Everything is a plugin.** Every feature — including one that replaces
   part of the shipped UI — is an ordinary `dsh` plugin package, installed
   through `dsh plugin --profile <name> add`/`remove`. There is no other
   installation path, no build-time flag, no environment variable that
   turns a feature on.

2. **Never patch, fork, or edit `packages/_vendor/deepseek-harness/`.** It
   is a pinned git submodule tracking `deepseek-ai/deepseek-harness`. The
   only legitimate way its contents change is a pin bump (`git submodule
   update --remote` + `pnpm install`), followed by re-verifying every
   plugin here still builds and boots against the new pin.

3. **A plugin's absence, or a plugin's failure, must never take down `dsh`
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
cosmokit, schemastery, …), `apps/*`, and `native/landlock-run` into this
workspace so `workspace:^` dependencies resolve against real upstream
sources.

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
| `dsh-plugins-api-workspace-file-controller` | Typert Host controller: list/read/write/create/delete/diff |
| `dsh-plugins-client-ui-file-editing` | Standalone file editor/preview/side-by-side-diff components, no shared-package dependency |
| `dsh-plugins-client-ui-workspace-files` | Sidebar Files tree; declares the optional `workspaceFilesNode` Context service — see "Files tree: why an optional service, not a slot" |
| `dsh-plugins-client-remotes-workspace-git` | Mounts the two controllers' generated `/remote` Client contributions — see "Plugin isolation" |
| `dsh-plugins-client-ui-workspace-enhanced` | Replaces `dsh-client-ui-workspace`'s own `sidebar.workspaces`/`conversation.hero.workspace` registrations; renders `workspaceFilesNode`'s `Component` as a Files sibling row — see "Replace, don't patch" |
| `dsh-plugins-client-ui-conversation-files` | Registers a `'file'` entry into `dsh-client-ui-conversation`'s pristine `conversation.view` slot; populated through `conversationFileOpener` — see "File tab: a pristine slot, but a fork-only trigger" |
| `dsh-plugins-client-ui-conversation-enhanced` | Replaces `dsh-client-ui-conversation`'s own conversation-shell registration; provides the `conversationFileOpener` cross-session bridge |
| `dsh-plugins-bundle-workspace-git` | `cordis.patch.yml` bundle: mounts `@deepseek-ai/dsh-workspace`; disables and replaces the `ui-workspace`/`ui-conversation` rows |

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
row and inserting a replacement that forks `ConversationRoot`,
`ConversationSessionHeader`, and `ConversationSession` (`InputBar` and
everything else stay unchanged). All three need forking, not just the one
whose render body drains the request: `dsh-client-ui-conversation`'s
pristine `session.blank && conversationPhase(...) === 'blank'` Hero gate is
duplicated across all three — `ConversationRoot`'s `hero` computation (which
also decides the composer's docked-vs-centered layout and the width
handles), `ConversationSessionHeader`'s `hideChrome` (the title/tabs row),
and `ConversationSession`'s own blank early-return (the view body) — so a
session that has never had a first turn would otherwise show a file
requested from the sidebar in a fully hidden tree, regardless of what
`openView` is told. Each fork's gate ORs in one more condition: the
session's `everOpenedFile` bit, a sticky (never reverts) per-session flag
that `FileOpenRegistry` sets the moment `conversationFileOpener.openFile`
is first called for that session. Once true, the session gets the same
active-phase layout (ordinary header, docked composer, width handles, all
tabs visible) an engaged session already has — a File preview opened before
any turn behaves exactly like one opened after. `dsh-plugins-client-ui-
workspace-files`'s `openFileInSession` still degrades correctly whenever
this bridge declines a request outright — no binding for the target
session, or this package installed without the File-tab package
(`dsh-plugins-client-ui-conversation-files`) — `FilesNode` falls back to its
own in-app preview modal in both cases, so the two packages remain
independently useful.

## Testing procedures

Two things need testing for any plugin change in this repo: the ordinary
install path, and the failure path.

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

### What each check catches

| Check | Catches |
|---|---|
| `tsc -b` (package + `tsconfig.client.json` full aggregate) | Type errors, including ones only visible once a package is wired into the whole client program |
| `pnpm run build` (host then client, per group) | Bundler-level failures — a cross-package import the purity gate rejects, a CSS Modules specifier the resolver can't follow, a Typert generator mismatch |
| `--dump-config` | Whether the composed `cordis.yml` tree is well-formed. Does *not* by itself confirm a disable/insert row resolved against something real — a `disabled: true` targeting a row that doesn't exist yet prints a non-fatal "entry not found" instead of erroring loud; read the printed tree |
| A real boot + `--dump-config` together | The install-order dependency between bundles (a `disabled: true` needs the row it targets already inserted by an earlier bundle) |
| A real boot + real browser DOM interaction | Whether the feature actually renders and functions — a served bundle manifest is necessary but not sufficient |
| Fault injection | Whether a plugin failing takes the rest of `dsh` down with it — no other check exercises this |

## Explicitly out of scope

`packages/shell/tool-bash`'s workdir-escape-preflight fix is a genuine
upstream bug fix unrelated to either feature here. It belongs in its own
PR against `deepseek-ai/deepseek-harness`.

## Open items

- **Bundle install order.** `dsh-plugins-bundle-workspace-git`'s
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
