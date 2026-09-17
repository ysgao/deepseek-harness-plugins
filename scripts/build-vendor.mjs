#!/usr/bin/env node
// Build the pinned vendor submodule (`pnpm run build:vendor`).
//
// Why this wrapper exists instead of a bare
// `pnpm --dir packages/_vendor/deepseek-harness run build`:
//
// The vendor carries its own pnpm workspace and lockfile, so `pnpm run` inside
// it runs a deps-status check that auto-invokes `pnpm install` there. That
// install fires the vendor's root `postinstall`,
// `scripts/install-lefthook.mjs`, which refuses to run when `core.worktree`
// lives in the repository's common git config:
//
//   [install-lefthook] cannot enable extensions.worktreeConfig while
//   core.worktree is in the common config
//   (file:.git/modules/vendor/deepseek-harness/config: "../../../../packages/_vendor/deepseek-harness")
//
// That layout is not a misconfiguration to repair — it is exactly how git
// writes a submodule's git dir, so the installer aborts on every checkout of
// this repo and takes `build:vendor` down with it (exit 1) before a single
// file is compiled. Article II forbids patching the vendor to fix it, so we
// take the installer's own documented early exit: it returns immediately when
// `CI` is `true`.
//
// Skipping it is also the correct behaviour, not merely a workaround. The
// installer's job is to install lefthook git hooks for people committing to
// the harness; nothing in this repo ever commits to the vendor (Article II),
// so the hooks it wants to install have no work to do here.
//
// `CI=true` is safe for the build itself: the vendor's `scripts/build.ts`
// never reads `CI`. The only vendor script that does is `scripts/run-oxlint.ts`
// (it switches lint output format), which `build` does not invoke.
//
// Upstream fix, if someone files it: teach `install-lefthook.mjs` to detect a
// submodule git dir and skip, rather than abort.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join('packages', '_vendor', 'deepseek-harness')

const result = spawnSync(
  'pnpm',
  ['--dir', vendorDir, 'run', 'build', ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, CI: 'true' }, shell: process.platform === 'win32' },
)

if (result.error !== undefined) {
  console.error(`[build-vendor] failed to spawn pnpm: ${result.error.message}`)
  process.exit(1)
}
if (result.signal !== null) {
  console.error(`[build-vendor] pnpm terminated by signal ${result.signal}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
