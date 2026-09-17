# deepseek-harness-plugins

Out-of-tree [`dsh`](https://github.com/deepseek-ai/deepseek-harness) plugin
bundles, developed against a pinned `deepseek-ai/deepseek-harness` submodule
instead of a fork.

[`CONSTITUTION.md`](CONSTITUTION.md) holds the rules this repo does not
trade away — read it before a non-trivial change.
Three independent bundles live here — see [`ARCHITECTURE.md`](ARCHITECTURE.md)
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

## Getting started

```sh
git clone --recurse-submodules <this repo>
cd deepseek-harness-plugins
pnpm install
```

`packages/_vendor/deepseek-harness` is a git submodule pinned to
`deepseek-ai/deepseek-harness`, unmodified. `pnpm-workspace.yaml` folds it
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

Then build this repo's own plugin packages:

```sh
pnpm run build   # tsc -b + tsdown, host then client
```

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
absolute package paths). `web` is one of the profile names `dsh` knows how
to auto-initialize from a shipped template (already including
`@deepseek-ai/dsh-base`/`@deepseek-ai/dsh-web-app`) on first use, so the
first `plugin add` against it is enough to bring the whole profile up:

```sh
./dsh plugin --profile web add "$(pwd)/packages/workspace-git/bundle-workspace-git"
./dsh plugin --profile web add "$(pwd)/packages/anthropic-subscription/bundle-anthropic-subscription"
./dsh plugin --profile web add "$(pwd)/packages/terminal/dsh-plugin-terminal"
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
   edit; a genuinely new bundle group needs its own line there.
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

Every package here targets `deepseek-ai/deepseek-harness` upstream
directly.
