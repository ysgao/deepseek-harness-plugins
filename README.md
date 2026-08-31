# deepseek-harness-plugins

Out-of-tree [`dsh`](https://github.com/deepseek-ai/deepseek-harness) plugin
bundles, developed against a pinned `deepseek-ai/deepseek-harness` submodule
instead of a fork.

Two independent bundles live here — see [`ARCHITECTURE.md`](ARCHITECTURE.md)
for the full package inventory, the seam each package registers into, and
the rationale:

- **`packages/workspace-git/`** — File manager sidebar (file tree, preview,
  in-app edit, side-by-side git diff) and its git status/commit/fetch/pull
  -rebase/push actions.
- **`packages/anthropic-subscription/`** — Anthropic subscription
  authorization, in the CLI and in Settings > Models.

## Getting started

```sh
git clone --recurse-submodules <this repo>
cd deepseek-harness-plugins
pnpm install
```

`vendor/deepseek-harness` is a git submodule pinned to a known commit;
`pnpm-workspace.yaml` folds it into this workspace so `workspace:^`
dependencies on `@deepseek-ai/dsh-*` resolve against real upstream sources
(those packages are not published to npm).

## Status

Phase 0: workspace scaffold, dependency wiring, and package inventory.
`pnpm install` is verified green. Feature code has not been ported yet —
each package under `packages/` is a stub; see its README for what it will
become.
