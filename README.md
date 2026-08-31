# deepseek-harness-plugins

Out-of-tree [`dsh`](https://github.com/deepseek-ai/deepseek-harness) plugin
bundles, developed against a pinned `deepseek-ai/deepseek-harness` submodule
instead of a fork.

Two independent bundles live here — see [`ARCHITECTURE.md`](ARCHITECTURE.md)
for the full package inventory, the seam each package registers into, and
the rationale:

- **`packages/workspace-git/`** — File manager sidebar (file tree, preview,
  in-app edit, side-by-side git diff) and its git status/commit/fetch/pull
  -rebase/push actions. **Confirmed working** — see Status below.
- **`packages/anthropic-subscription/`** — Anthropic subscription
  authorization, in the CLI and in Settings > Models. **CLI and RPC surface
  confirmed working end to end**; the Settings UI panel is a documented
  upstream-PR candidate instead — see `ARCHITECTURE.md`.

## Getting started

```sh
git clone --recurse-submodules <this repo>
cd deepseek-harness-plugins
pnpm install
```

`packages/_vendor/deepseek-harness` is a git submodule pinned to a known
commit; `pnpm-workspace.yaml` folds it into this workspace so `workspace:^`
dependencies on `@deepseek-ai/dsh-*` resolve against real upstream sources
(those packages are not published to npm). It's nested under `packages/`
rather than a sibling `vendor/` directory for a load-bearing reason — see
"Dependency source" in `ARCHITECTURE.md`.

Build the submodule once (both faces — some packages only emit during the
client pass). Its own `pnpm run` scripts fail here on a git-worktree-specific
`postinstall` quirk (see "Dependency source" in `ARCHITECTURE.md`), so
invoke the underlying commands directly:

```sh
cd packages/_vendor/deepseek-harness
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json
./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.client.json
./node_modules/.bin/tsdown --env.DSH_BUILD_FACE client
cd ../../..
```

Then build this repo's own packages (also both faces — `pnpm run` works
fine here, this repo has no such quirk):

```sh
pnpm run build:lib:host
pnpm run build:lib:client
```

## Running a plugin

**Don't rely on a bare `dsh` from your `PATH`.** If you've ever developed
against `yga/deepseek-harness` (or any other checkout) on this machine, a
globally-linked `dsh` may silently resolve to *that* build instead of this
repo's — `which dsh` can point anywhere. Shadow it for the session with a
function pointing at this repo's own built CLI (a plain
`DSH="node .../bin.js"` variable does **not** work as a command prefix in
zsh — unquoted parameter expansion isn't word-split the way it is in bash):

```sh
dsh() { node "$(pwd)/packages/_vendor/deepseek-harness/apps/cli/lib/bin.js" "$@"; }
```

Nothing here is published to npm — install with `link:` against an
**absolute** path (a relative one resolves against the target profile's own
directory, not your shell's cwd, and silently no-ops instead of erroring):

```sh
DSH_HOME=/some/scratch/dir dsh plugin --profile acp add \
  "link:$(pwd)/packages/anthropic-subscription/bundle-anthropic-subscription"
DSH_HOME=/some/scratch/dir dsh plugin --profile anthropic add \
  "link:$(pwd)/packages/anthropic-subscription/cli-login-app"
DSH_HOME=/some/scratch/dir dsh --profile anthropic llm-pi-ai/anthropic
```

```sh
DSH_HOME=/some/scratch/dir dsh plugin --profile web-app add "@deepseek-ai/dsh-web-app"   # first — see below
DSH_HOME=/some/scratch/dir dsh plugin --profile web-app add \
  "link:$(pwd)/packages/workspace-git/bundle-workspace-git"
DSH_HOME=/some/scratch/dir dsh --profile web-app
```

Two things the `workspace-git` bundle needs that aren't obvious:

- **Install order matters.** This bundle's `cordis.patch.yml` disables
  `dsh-client-ui-workspace`'s and `dsh-client-ui-conversation`'s own rows
  and replaces them — but those rows only exist once
  `@deepseek-ai/dsh-web-app`'s own bundle has already inserted them, and
  `cordis.patch.yml` operations apply in `dsh.profile.bundles` order.
  Install `dsh-web-app` first, or the disables print harmless no-op
  warnings instead of taking effect.
- **`apps/web`'s Vite frontend needs its own build** before `dsh --profile
  web-app` (i.e. `dsh web`) has anything to serve — a separate step from
  the "Getting started" builds above, easy to miss:
  ```sh
  cd packages/_vendor/deepseek-harness/apps/web
  NODE_OPTIONS="--max-old-space-size=4096" ./node_modules/.bin/vite build
  cd ../../../../..
  ```
  Skipping it doesn't fail at boot — every page just serves a `404`, which
  reads as "it's running, just blank" rather than the missing build step it
  actually is.

`web-app` produces minimal stdout output (just the served URL) and stays
running (it's a long-lived server/UI profile, not a one-shot task) — that's
expected, not a hang; `Ctrl+C` to stop it. `acp`/`anthropic` above are
one-shot and exit on their own.

Point `DSH_HOME` at a scratch directory the first time (or omit it entirely
to use your real `~/.dsh` if you want the plugin available in your everyday
profile) — `dsh plugin add` initializes the profile there if it doesn't
exist yet.

**What "running" actually verifies today:** Host-side plugins (the Typert
controllers, the CLI login app, the authorization bundle) are fully real —
`dsh --profile <name>` boots and runs them for real, no caveats. The
`workspace-git` Client packages install, compose, and build real browser
bundles that a live `dsh web` server correctly serves — verified at the
wire level (the served combo-script manifest lists exactly the expected
packages, with `dsh-client-ui-workspace`'s and `dsh-client-ui-conversation`'s
own bundles correctly absent after each replacement). What's still
unverified is genuine browser-side DOM
rendering — this session's own browser-automation tooling couldn't
complete a normal page load against the local dev auth flow, for reasons
that look tool-specific rather than code-specific. See `ARCHITECTURE.md`'s
"Confirmed working" and Open items for the full account.

## Development workflow

Adding a new ported feature or extending an existing one:

1. **One package, one seam.** Each package here corresponds to exactly one
   thing it registers into upstream (a Typert Host controller, a Client
   Context service, a slot entry) — see `ARCHITECTURE.md`'s package
   inventory for the established shape. Don't fold two seams into one
   package.
2. **Client packages need the Host/Client entry-point split.** If a Client
   package's real code (transitively) imports a CSS Module — almost
   anything importing from `@deepseek-ai/dsh-client-ui-primitives` does —
   its default `.` export must stay a no-op (`export function apply(): void
   {}`), with the real `apply`/`inject` under `./client`, declared via a
   `dsh.client` field in `package.json`. Skipping this crashes the very
   first real boot with `ERR_UNKNOWN_FILE_EXTENSION` — see
   `packages/workspace-git/bundle-workspace-git/README.md` for the full
   story of how this was found. Host-only packages (Typert controllers,
   plain component libraries with no Cordis registration like
   `dsh-plugins-client-ui-file-editing`) don't need this.
3. **Register the package** in `tsconfig.host.json` or `tsconfig.client.json`
   (`references`) and in `tsdown.config.ts`'s `HOST_PACKAGES` /
   `CLIENT_PACKAGES` array. `pnpm-workspace.yaml` already globs
   `packages/*/*`, so a new directory needs no separate workspace edit.
4. **Verify before committing** — typecheck, build, then a real boot, not
   just typecheck:
   ```sh
   pnpm run typecheck
   pnpm run build:lib:host
   pnpm run build:lib:client
   DSH_HOME=/tmp/dsh-verify dsh plugin --profile acp add "link:$(pwd)/packages/<group>/<bundle>"
   DSH_HOME=/tmp/dsh-verify dsh --profile acp < /dev/null   # should exit 0, no thrown errors
   ```
   (the `dsh` function defined in "Running a plugin", above — not a bare `dsh` off `PATH`.)
   A clean typecheck does **not** catch the entry-point issue above, or
   missing peer services at boot — only a real boot does. `--dump-config`
   alone doesn't either (it resolves config, never imports plugin modules).
5. **Update `ARCHITECTURE.md`** — package inventory table, and a short
   subsection if the change involved a real design decision (why this seam,
   not that one) or a finding worth not rediscovering later.
6. **Bumping the submodule pin:** `git submodule update --remote` inside
   `packages/_vendor/deepseek-harness`, then `pnpm install`, rebuild both
   faces (Getting started, above), and re-run the verification steps —
   treat it like any other dependency bump; review what changed upstream
   before committing the new pin.

Every package here still targets `deepseek-ai/deepseek-harness` upstream —
none of it depends on the `yga/deepseek-harness` fork this repo replaces,
which stays untouched as a reference/backup.

## Status

Both bundles are implemented and confirmed working end to end (build +
typecheck + real `dsh plugin add` + real boot):

- `packages/anthropic-subscription/`: `dsh-plugins-api-authorization-
  controller`, `dsh-plugins-bundle-anthropic-subscription`, and
  `dsh-plugins-cli-login-app`. The Settings UI panel
  (`dsh-plugins-client-ui-settings-anthropic-subscription`) is a documented
  stub — see `ARCHITECTURE.md` for why it's an upstream-PR candidate
  instead of an out-of-tree package.
- `packages/workspace-git/`: `dsh-plugins-api-workspace-git-controller`,
  `dsh-plugins-api-workspace-file-controller`,
  `dsh-plugins-client-ui-file-editing`, `dsh-plugins-client-ui-workspace-
  files`, `dsh-plugins-client-ui-workspace-enhanced`,
  `dsh-plugins-client-ui-conversation-files`,
  `dsh-plugins-client-ui-conversation-enhanced`, and
  `dsh-plugins-bundle-workspace-git`. Neither the sidebar Files tree's mount
  point nor the `conversationFileOpener` cross-session bridge (letting the
  sidebar dock a file into the current session's File tab) needs an
  upstream PR — `dsh-plugins-client-ui-workspace-enhanced` and
  `dsh-plugins-client-ui-conversation-enhanced` each replace their
  respective pristine package's own registration wholesale via ordinary
  `cordis.patch.yml` disable+insert (see `ARCHITECTURE.md`'s "Why replace
  the plugin instead of patching it"; a smaller patch-based alternative for
  the Files-tree mount point is kept drafted but unsubmitted).
