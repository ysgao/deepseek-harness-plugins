# dsh-plugins-client-ui-workspace-files

**Status: Phase 0 scaffold — not yet implemented.**

The File tree sidebar entry (`FilesNode`), its file viewer, and git status
badges/action buttons (commit, fetch, pull `--rebase`, push, discard),
registered into `@deepseek-ai/dsh-client-ui-workspace`'s existing sidebar
slot contract instead of editing that package's source.

Ports `packages/client/ui-workspace/src/client/files/{FilesNode,FileViewer,
classify}.tsx` (+ tests) from `yga/deepseek-harness`. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) Open Items — the exact
`ui-workspace` slot this registers into (an existing hole, or a small
upstream-proposed addition) is still to be confirmed.
