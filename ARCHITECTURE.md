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

Neither bundle patches, copies, or forks any file under `vendor/deepseek-harness/`.
Every package here only *depends on* published seams (`ctx.authorization`,
Typert-registered Host controllers auto-discovered by `dsh-typert-loader`,
and the `SlotMap` extension points `ui-workspace`, `ui-conversation`, and
`ui-settings-models` already declare) and installs into a profile via
`dsh plugin --profile <name> add <package>` (see
`vendor/deepseek-harness/packages/bundle/README.md`).

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
`@deepseek-ai/cordis` is). `vendor/deepseek-harness/` is a git submodule
pinned to a `deepseek-ai/deepseek-harness` commit; `pnpm-workspace.yaml`
folds its `packages/*/*`, `vendor/*` (Cordis, cosmokit, schemastery, …),
`apps/*`, and `native/landlock-run` into this workspace so `workspace:^`
dependencies resolve against real upstream sources. Bumping the pin is a
plain `git submodule update --remote` + `pnpm install`, reviewed like any
other dependency bump.

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

### `packages/anthropic-subscription/` — Anthropic subscription authorization

| Package | Seam it registers into | Ported from (`yga/deepseek-harness`) |
|---|---|---|
| `dsh-plugins-llm-anthropic-subscription` | `ctx.authorization.registerFlow()` — the seam is already built for exactly this (see its own module doc: *"a plugin that knows how to obtain its own credential registers a flow"*) | New plugin wrapping `@earendil-works/pi-ai`'s Anthropic OAuth login, using `packages/llm/llm-pi-ai/src/{auth,login}.ts` (already upstream, unmodified by the fork) as the credential-writing mechanics |
| `dsh-plugins-api-authorization-controller` | New Typert Host controller | `packages/api/settings-controller/src/authorization.ts` (271 lines) + `tests/authorization.host.spec.ts` |
| `dsh-plugins-client-ui-settings-anthropic-subscription` | `ui-settings-models`'s existing `settings.models.provider-card` / `settings.models.footer` slots — its own `slot-contract.ts` documents these as *"the two seats through which a plugin distributed outside this repository adds UI to the Models settings section without editing it"* | `packages/client/ui-settings-models/src/client/{AuthorizationPanel.tsx,authorization-runtime.ts}` + tests |
| `dsh-plugins-headless-anthropic-login` | Out-of-tree `cordis.patch.yml` insert for the `headless` profile | Replaces the direct edits to `packages/bundle/headless/src/{index,startup}.ts` (the CLI login command) |
| `dsh-plugins-bundle-anthropic-subscription` | `cordis.patch.yml` bundle for `headless`/`web-app` profiles | New |

## Explicitly out of scope

`packages/shell/tool-bash`'s workdir-escape-preflight fix (also present in
the fork's diff) is a genuine upstream bug fix unrelated to either feature.
It belongs in its own PR against `deepseek-ai/deepseek-harness`, not in
either bundle here.

## Open items for Phase 1 (porting)

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

## Status

This is the Phase 0 scaffold: workspace, dependency wiring, and package
inventory only. `pnpm install` is verified green against the pinned
submodule. No feature code has been ported yet — each package below is a
stub with a README describing its target contract.
