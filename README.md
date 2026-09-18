# deepseek-harness-plugins

Out-of-tree [`dsh`](https://github.com/deepseek-ai/deepseek-harness) plugin
bundles, developed against a pinned `deepseek-ai/deepseek-harness` submodule
instead of a fork.

[`CONSTITUTION.md`](CONSTITUTION.md) holds the rules this repo does not
trade away — read it before a non-trivial change.
Four independent bundles live here — see [`ARCHITECTURE.md`](ARCHITECTURE.md)
for the full package inventory, the seam each package registers into, and
the design rationale:

- **`packages/workspace-git/`** — File manager sidebar (file tree, preview,
  in-app edit, side-by-side git diff) and its git status/commit/fetch/pull
  -rebase/push actions.
- **`packages/anthropic-subscription/`** — Anthropic subscription
  authorization, in the CLI and in Settings > Models.
- **`packages/terminal/`** — Bottom terminal panel (`node-pty`-backed,
  multi-tab). An in-repo fork of the third-party npm package
  `dsh-plugin-terminal`, not of `deepseek-harness` itself — see its own
  `README.md` for what was changed and why (an unauthenticated-shell-access
  bug and a broken `node-pty` prebuild in the upstream version).
- **`packages/mcp-connector/`** — MCP connectors, including remote servers
  behind OAuth 2.0. A superset of `@deepseek-ai/dsh-mcp-client` (same stdio
  and static-header transports, same config, same tool names) plus an
  authorization-code flow with unattended token refresh, a durable connector
  registry, a Settings page, and a `--json` CLI an agent can drive. A server
  needing an API token names a credential rather than storing one, so the
  settings document holds no secrets; one offering dynamic client registration
  needs no console work at all.

## Getting started

```sh
git clone --recurse-submodules <this repo>
cd deepseek-harness-plugins
pnpm install
```

`pnpm install` also runs `scripts/install-git-hooks.mjs`, which points this
clone's `core.hooksPath` at the tracked `.githooks/` directory so the
Article II pre-commit gate is active without a separate setup step. It sets
one git config key and nothing else; if your clone already has a
`core.hooksPath`, it says so and leaves it alone rather than taking your
hooks over — then the gate is only `pnpm run check:vendor`, run by hand. It
never fails an install.

`packages/_vendor/deepseek-harness` is a git submodule pinned to
`deepseek-ai/deepseek-harness`, unmodified — and enforced as such, not just
asked for. `pnpm run check:vendor` fails if the vendor working tree is dirty
or if the submodule pin has moved away from `vendorPin` in
`scripts/replacement-parity.json`, `.claude/settings.json` denies
`Edit`/`Write` under `packages/_vendor/**`, and the pre-commit hook above runs
the check on every commit. [`CONSTITUTION.md`](CONSTITUTION.md) Article II
says why, and what to do instead (Article III: a replacement, in this repo's
own packages). `pnpm-workspace.yaml` folds it
into this workspace so `workspace:^` dependencies on `@deepseek-ai/dsh-*`
resolve against real upstream sources (those packages are not published to
npm). It's nested under `packages/` rather than a sibling `vendor/`
directory for a load-bearing reason — see "Dependency source" in
`ARCHITECTURE.md`.

Build the vendored submodule (host libraries, client libraries, and the
`apps/web` frontend) from the workspace root:

```sh
pnpm run build:vendor
```

That goes through `scripts/build-vendor.mjs` rather than calling `pnpm
--dir ... run build` directly. The vendor has its own workspace and
lockfile, so `pnpm run` inside it auto-installs, and that install fires the
vendor's `postinstall` lefthook installer, which aborts on any checkout
where the git dir is a submodule's (`cannot enable
extensions.worktreeConfig while core.worktree is in the common config`).
The wrapper sets `CI=true`, the installer's own early exit; the hooks it
would install have no work to do here, since nothing in this repo ever
commits to the vendor. The file explains it at length.

If `build:vendor` fails in some other way, check the submodule is actually
at the pinned commit first — a stale checkout is the usual cause:

```sh
git submodule update --init --recursive packages/_vendor/deepseek-harness
```

Then build this repo's own plugin packages:

```sh
pnpm run build   # tsc -b + tsdown, host then client, then install:plugins
```

`build` ends by running `pnpm run install:plugins`
(`scripts/install-plugins.mjs`), which adds every bundle below that the
`web` profile doesn't have yet — through the same `./dsh plugin --profile
web add <path>` documented under "Running", in the order that section
requires, and nothing else. It is idempotent (a profile that already has
all of them is a no-op), honors `DSH_HOME`, and skips itself entirely when
`CI` is set. A bundle built but never installed is invisible in the app
with nothing in the build output to say why; this closes that gap. It also
fails the build if an install drops a bundle it wasn't asked to touch —
`dsh plugin add` reconciles the whole layer list against installed state and
silently unlists anything it can't resolve. Pass `--profile <name>` or
`--dry-run` when running it directly:

```sh
node scripts/install-plugins.mjs --profile web-verify --dry-run
```

**An install only reaches a running app on its next boot.** `dsh`'s
`patchReload: "live"` covers the profile's own `cordis.patch.yml`, not its
`dsh.profile.bundles` list, so restart any live `./dsh --profile web` after
a build that installed something (the script says when it did).

## Running

**Don't rely on a bare `dsh` from your `PATH`** — a globally-linked `dsh`
(from an unrelated project, a different checkout) may exist on the same
machine, and there is no reliable way to tell which one a bare `dsh`
resolves to from the command name alone. This repo ships its own
unambiguous entry point instead: `./dsh` at the repo root always resolves
to this repo's own built CLI (`packages/_vendor/deepseek-harness/apps/cli/
lib/bin.js`) via its own script location, never via `$PATH` — run it from
anywhere as `./dsh` (repo root) or the script's full path.

Install a bundle into a profile with `./dsh plugin --profile <name> add
<path>` (nothing here is published to npm, so pass this repo's own
absolute package paths). `pnpm run build` already does exactly this for the
`web` profile; the commands below are that same install path by hand, for
any other profile name and for reading what the build does. `web` is one of
the profile names `dsh` knows how to auto-initialize from a shipped template
(already including `@deepseek-ai/dsh-base`/`@deepseek-ai/dsh-web-app`) on
first use, so the first `plugin add` against it is enough to bring the whole
profile up:

```sh
./dsh plugin --profile web add "$(pwd)/packages/workspace-git/bundle-workspace-git"
./dsh plugin --profile web add "$(pwd)/packages/anthropic-subscription/bundle-anthropic-subscription"
./dsh plugin --profile web add "$(pwd)/packages/terminal/dsh-plugin-terminal"
./dsh plugin --profile web add "$(pwd)/packages/mcp-connector/bundle-mcp-connector"
./dsh --profile web
```

**Install order matters for any profile name `dsh` does *not* auto-initialize
this way.** `bundle-workspace-git` and `bundle-anthropic-subscription` each
disable a row (`ui-workspace`, `ui-conversation`, `ui-settings-models`) that
only exists once whatever bundle mounts `dsh-client-ui-workspace`/
`dsh-client-ui-conversation`/`dsh-client-ui-settings-models` (`@deepseek-ai/
dsh-web-app` for the recognized profile names) has already inserted it —
`cordis.patch.yml` operations apply in `dsh.profile.bundles` order, so that
bundle must be added first.

The standalone CLI login profile doesn't need `dsh-web-app` at all:

```sh
./dsh plugin --profile anthropic add "$(pwd)/packages/anthropic-subscription/cli-login-app"
./dsh --profile anthropic llm-pi-ai/anthropic
```

`dsh plugin add` initializes a named profile under `~/.dsh/profiles/` if it
doesn't exist yet; pass `DSH_HOME=/some/scratch/dir` before any of the
commands above to keep a profile out of your real `~/.dsh` while trying
something out.

## Development workflow

1. **One package, one seam.** Each package corresponds to exactly one thing
   it registers into upstream (a Typert Host controller, a Client Context
   service, a slot entry) — see `ARCHITECTURE.md`'s package inventory for
   the established shape.
2. **Client packages need the Host/Client entry-point split** whenever
   their real code transitively imports a CSS Module (almost anything
   importing from `@deepseek-ai/dsh-client-ui-primitives` does): the
   default `.` export stays a no-op (`export function apply(): void {}`),
   with the real `apply`/`inject` under `./client`, declared via a
   `dsh.client` field in `package.json`. Host-only packages and plain
   component libraries with no Cordis registration don't need this.
3. **Register the package** in `tsconfig.host.json` or
   `tsconfig.client.json` (`references`), and either add it to
   `tsdown.config.ts`'s `HOST_PACKAGES`/`CLIENT_PACKAGES` array or give it
   its own `tsdown.config.ts` for a real browser bundle — see an existing
   Client package for the pattern. `pnpm-workspace.yaml` already globs
   `packages/workspace-git/*` and `packages/anthropic-subscription/*`, so a
   new package inside either existing group needs no separate workspace
   edit; a genuinely new bundle group needs its own line there, plus its
   bundle package in `scripts/install-plugins.mjs`'s `BUNDLES` array — at
   the position its `cordis.patch.yml` layer has to apply in — so
   `pnpm run build` installs it like every other bundle.
4. **Verify with a real boot, not just typecheck.** A clean typecheck does
   not catch a missing entry-point split or a missing peer service at
   boot; `--dump-config` alone doesn't either (it resolves config, never
   imports plugin modules). See `ARCHITECTURE.md`'s "Testing procedures"
   for the full verification and fault-injection routine.
5. **Update `ARCHITECTURE.md`** — the package inventory table, and a short
   subsection for any real design decision (why this seam, not that one).
6. **Bumping the submodule pin:** `git submodule update --remote` inside
   `packages/_vendor/deepseek-harness`, then `pnpm install`, rebuild both
   faces (Getting started, above), and re-run verification. It is *not*
   like any other dependency bump in one respect: three packages here
   disable a vendor plugin row and stand in for it, so a pin bump that adds
   a slot, a locale key or a config field upstream silently leaves those
   replacements registering last release's surface — with a clean
   typecheck. Run `pnpm run check:parity`, re-fork whatever it names, and
   only then record the new hashes; see `ARCHITECTURE.md`'s "Replacement
   parity" and [`CONSTITUTION.md`](CONSTITUTION.md) Article III–IV.

   Move `vendorPin` in `scripts/replacement-parity.json` to the new commit
   **in the same change**. `pnpm run check:vendor` — and therefore the
   pre-commit hook — fails while the submodule and that field disagree,
   which is deliberate: that disagreement is precisely the window in which
   every fork hash in the file still describes the previous release.

Every package here targets `deepseek-ai/deepseek-harness` upstream
directly.
