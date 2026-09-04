# dsh-plugins-api-workspace-file-controller

**Status: implemented.** `src/files.ts`/`src/controller.ts` implement the
full listing/read/atomic-write/create/diff surface described below,
including a version-hash staleness guard on writes, atomic (temp-file +
rename) publication, and real (symlink-resolved) workspace-root containment
on every method — not a scaffold. See
[`dsh-plugins-bundle-workspace-git`'s own README](../bundle-workspace-git/README.md)
for real-`dsh web`-boot verification covering this row's composition.

A Host Typert controller that owns the file RPC surface for a workspace:
list entries, read/write file content, create file/directory, and diff
against the git index. Deleting a file or directory is not yet exposed on
this surface — only listing, reading, writing, and creating.

Ports `packages/api/workspace-controller/src/{files,file-commands}.ts` and
their host specs from `yga/deepseek-harness`, without editing
`@deepseek-ai/dsh-api-workspace-controller` itself. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — including the open question
of whether this should merge with `dsh-plugins-api-workspace-git-controller`.

## Known Limitations and Deferred Work

- Workspace-root containment (`controller.ts`'s `requireContainedPath`) is a
  check-then-use pair, not one atomic operation: it resolves both the
  workspace root and the candidate path to their real (symlink-followed)
  location and rejects an escape, then returns the ORIGINAL (not the real)
  path for the caller's own `stat`/`readFile`/`writeFile`/`mkdir` to act on.
  A symlink SWAPPED between that check and the later filesystem call — not a
  symlink merely present, which the check does catch — could still redirect
  the operation outside the workspace. Closing this fully would need
  `O_NOFOLLOW`-based syscalls Node's high-level `fs`/`fs/promises` API does
  not expose portably (POSIX-only, and not for every operation this module
  performs). This narrows the practically exploitable case (a symlink
  checked into a cloned repository, static for the life of the request) to
  a much harder one (an attacker with concurrent write access to the
  workspace directory racing the exact request window).
