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
| `dsh-plugins-client-ui-workspace-files` | `ui-workspace`'s sidebar slot (exact hole TBD — see Open Items) | `packages/client/ui-workspace/src/client/files/{FilesNode,FileViewer,classify}.tsx` + tests |
| `dsh-plugins-client-ui-conversation-files` | `ui-conversation`'s existing file-opener/slot mechanism | `packages/client/ui-conversation-files/**` (already a clean, separate package upstream in the fork — ported close to as-is, repointed at `dsh-plugins-client-ui-file-editing` instead of `ui-primitives`) |
| `dsh-plugins-bundle-workspace-git` | `cordis.patch.yml` bundle, out-of-tree install target for `web-app`/`base` profiles | New — replaces the direct edits to `packages/bundle/base/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml` |

Not started yet (Phase 0 stub only) — everything above is unbuilt source.

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

## Explicitly out of scope

`packages/shell/tool-bash`'s workdir-escape-preflight fix (also present in
the fork's diff) is a genuine upstream bug fix unrelated to either feature.
It belongs in its own PR against `deepseek-ai/deepseek-harness`, not in
either bundle here.

## Open items

- `packages/workspace-git/*` is still Phase 0 stubs — port next, following
  the pattern established by `anthropic-subscription`.
- Confirm `ui-workspace`'s sidebar slot contract has (or needs) a hole for
  a File tree entry alongside `WorkspaceBrowser`; if none fits, that is a
  small, self-contained upstream PR proposal (a new `SlotMap` key), not a
  local patch.
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
