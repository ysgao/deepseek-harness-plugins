# upstream-patches

Small diffs against pristine `deepseek-ai/deepseek-harness` this repo depends
on (via `packages/_vendor/deepseek-harness`, a pinned submodule) but cannot
provide as out-of-tree plugins — because the seam they add doesn't exist yet
upstream. Each patch here is meant to be proposed to
`deepseek-ai/deepseek-harness` directly as its own small PR, generalized
(not project-specific) wherever the underlying feature already is.

Verified by: `git apply --check` against the exact pinned submodule commit,
plus a forced clean `tsc -b` rebuild of the touched package with the patch
applied (see each entry below) — then the submodule working tree was
reverted to pristine (`git checkout -- .`) so the pin stays untouched.
The submodule is a transient scratch surface for producing these patches,
never a place this repo commits to.

## 0001-workspace-files-node-optional-service.patch

Adds the `workspaceFilesNode` optional Context service to
`dsh-client-ui-workspace` (`packages/client/ui-workspace/src/client/
{contract/slots.ts,index.ts,rows/WorkspaceBrowser.tsx}`), following this
codebase's own documented convention for optional cross-package services
(`packages/AGENTS.md`: "Optional services use `ctx.get(name)`"). Lets a
separately-composed package provide a Files-tree sibling row for a real
Workspace group — the first row under its header, sibling to its Session
rows, the selected Workspace's own directory as the tree's implicit root —
without `dsh-client-ui-workspace` depending on that package or exposing a
new `SlotMap` child key for it.

- 3 files changed, 51 insertions(+), 2 deletions(-).
- Verified: `git apply --check` clean against pinned commit `0a53fb55be`;
  forced clean rebuild of `packages/client/ui-workspace/tsconfig.json`
  (`tsc -b --force`) with the patch applied — exit 0, no diagnostics.
- Consuming side: `packages/workspace-git/client-ui-workspace-files` in this
  repo — see that package's own README, "Mount point (upstream-ready diff)",
  for what renders through `filesNode.Component` once this lands.
