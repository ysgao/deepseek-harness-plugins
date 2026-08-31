# dsh-plugins-api-workspace-git-controller

**Status: Phase 0 scaffold — not yet implemented.**

A new Host Typert controller (own `TypertRemoteService`, auto-discovered by
`@deepseek-ai/dsh-typert-loader`) that owns the git RPC surface for a
workspace: status, commit-all, fetch, pull `--rebase`, push, discard-all.

Ports `packages/api/workspace-controller/src/workspace-git.ts` and its host
spec from `yga/deepseek-harness`, without editing
`@deepseek-ai/dsh-api-workspace-controller` itself. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) for the full inventory and
rationale.
