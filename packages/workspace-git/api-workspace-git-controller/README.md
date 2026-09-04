# dsh-plugins-api-workspace-git-controller

**Status: implemented.** `src/git.ts`/`src/controller.ts` implement the full
status/commit-all/discard-all/fetch/pull-rebase/push surface described below
against the host's own `git` binary via no-shell `execFile` (no string ever
reaches a shell) — not a scaffold. See
[`dsh-plugins-bundle-workspace-git`'s own README](../bundle-workspace-git/README.md)
for real-`dsh web`-boot verification covering this row's composition.

A Host Typert controller (own `TypertRemoteService`, auto-discovered by
`@deepseek-ai/dsh-typert-loader`) that owns the git RPC surface for a
workspace: status, commit-all, fetch, pull `--rebase`, push, discard-all.

Ports `packages/api/workspace-controller/src/workspace-git.ts` and its host
spec from `yga/deepseek-harness`, without editing
`@deepseek-ai/dsh-api-workspace-controller` itself. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) for the full inventory and
rationale.
