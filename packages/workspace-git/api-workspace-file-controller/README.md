# dsh-plugins-api-workspace-file-controller

**Status: Phase 0 scaffold — not yet implemented.**

A new Host Typert controller that owns the file RPC surface for a workspace:
list entries, read/write file content, create file/directory, delete, and
diff against the git index.

Ports `packages/api/workspace-controller/src/{files,file-commands}.ts` and
their host specs from `yga/deepseek-harness`, without editing
`@deepseek-ai/dsh-api-workspace-controller` itself. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — including the open question
of whether this should merge with `dsh-plugins-api-workspace-git-controller`.
