#!/usr/bin/env node
// Point this clone's git hooks at the tracked .githooks/ directory, so the
// Article II pre-commit gate is active without anyone having to run anything.
//
// Wired as the root package's `postinstall`, which is the only moment we can
// count on: `pnpm install` is already step one of this repo's README.
//
// Deliberately NOT a hook manager. The vendored harness ships lefthook and its
// own installer, and that installer is precisely what breaks under a submodule
// git dir (see scripts/build-vendor.mjs). Setting one git config key needs
// none of that machinery, and cannot fail the same way.
//
// This script never fails an install. A postinstall that can abort `pnpm
// install` is a liability -- that is the exact failure 61803af had to work
// around in the vendor -- so every problem here is a warning and exit 0. The
// worst case is that hooks are not wired and the check runs only via
// `pnpm run check:vendor`.
//
// Usage: node scripts/install-git-hooks.mjs
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS_DIR = '.githooks'

function warn(message) {
  console.log(`install-git-hooks: ${message}`)
}

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return undefined
  return result.stdout.trim()
}

// CI checks out fresh and never commits, so there is nothing for a pre-commit
// hook to guard there. (The vendor's own installer takes the same exit.)
if (process.env.CI) {
  warn('CI set — skipping hook wiring')
  process.exit(0)
}

if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  warn('not a git work tree — skipping hook wiring')
  process.exit(0)
}

const current = git(['config', '--get', 'core.hooksPath'])
if (current === HOOKS_DIR) {
  process.exit(0) // already wired; stay quiet on every rebuild
}

if (current !== undefined) {
  // Someone (or some tool) already owns hooks in this clone. Overwriting that
  // could silently disable their hooks, which is not this script's call.
  warn(`core.hooksPath is already set to "${current}" — leaving it alone.`)
  warn(`  The Article II gate is NOT active. Either run \`git config core.hooksPath ${HOOKS_DIR}\``)
  warn(`  or call scripts/check-vendor-pristine.mjs from your own hook.`)
  process.exit(0)
}

if (git(['config', 'core.hooksPath', HOOKS_DIR]) === undefined) {
  warn(`could not set core.hooksPath — the Article II pre-commit gate is not active.`)
  process.exit(0)
}

warn(`hooks wired to ${HOOKS_DIR}/ (Article II pre-commit gate active)`)
