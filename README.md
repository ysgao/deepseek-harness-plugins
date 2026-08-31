# deepseek-harness-plugins

Out-of-tree [`dsh`](https://github.com/deepseek-ai/deepseek-harness) plugin
bundles, developed against a pinned `deepseek-ai/deepseek-harness` submodule
instead of a fork.

Two independent bundles live here — see [`ARCHITECTURE.md`](ARCHITECTURE.md)
for the full package inventory, the seam each package registers into, and
the rationale:

- **`packages/workspace-git/`** — File manager sidebar (file tree, preview,
  in-app edit, side-by-side git diff) and its git status/commit/fetch/pull
  -rebase/push actions. *(Phase 0 stub — not yet ported.)*
- **`packages/anthropic-subscription/`** — Anthropic subscription
  authorization, in the CLI and in Settings > Models. *(CLI and RPC surface
  confirmed working end to end; the Settings UI panel is a documented
  upstream-PR candidate instead — see `ARCHITECTURE.md`.)*

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
client pass):

```sh
cd packages/_vendor/deepseek-harness
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json
./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.client.json
./node_modules/.bin/tsdown --env.DSH_BUILD_FACE client
```

Then build this repo's own packages from the repo root:

```sh
pnpm run build:lib:host
```

Try a package locally, without publishing anything, via `link:`:

```sh
dsh plugin --profile acp add link:packages/anthropic-subscription/bundle-anthropic-subscription
dsh plugin --profile anthropic add link:packages/anthropic-subscription/cli-login-app
dsh --profile anthropic llm-pi-ai/anthropic
```

## Status

`packages/anthropic-subscription/` is implemented and confirmed working:
`dsh-plugins-api-authorization-controller`,
`dsh-plugins-bundle-anthropic-subscription`, and
`dsh-plugins-cli-login-app` all build clean and boot clean through a real
`dsh plugin --profile <name> add` install. The Settings UI panel
(`dsh-plugins-client-ui-settings-anthropic-subscription`) is a documented
stub — see `ARCHITECTURE.md` for why it's an upstream-PR candidate instead
of an out-of-tree package. `packages/workspace-git/` is still Phase 0
scaffold — package inventory and stubs only, not yet ported.
