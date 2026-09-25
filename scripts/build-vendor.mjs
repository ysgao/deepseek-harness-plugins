#!/usr/bin/env node
// Build the pinned vendor submodule (`pnpm run build:vendor`).
//
// Two things happen before a single vendor file compiles: a preflight
// (`assertBuildEnvironment`, CONSTITUTION.md Article VII) proves the checkout
// on disk is actually usable, then the vendor's own build runs through a
// wrapper that works around one packaging quirk (below). Both exist for the
// same reason: a submodule pin bump moves the target this repo builds
// against, and nothing about `git checkout` or a stale `node_modules`
// announces that the target moved out from under you — the first sign is
// normally a build error deep inside `tsc`/`tsdown` that reads like a vendor
// bug.
//
// Why the pnpm wrapper exists instead of a bare
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
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join('packages', '_vendor', 'deepseek-harness')
const vendorAbs = join(repoRoot, vendorDir)

// The exact directories tsdown's own workspace config discovers when it
// builds the vendor (see its `tsdown.config.ts`: `workspace: ['vendor/*',
// 'packages/*/*', 'apps/cli', 'apps/desktop-host']`). Mirrored here, not
// imported from there, because the failure mode this guards against is a
// checkout old enough that the config on disk might not even be the one
// that shipped this list — the check has to work from what a *pinned*
// vendor promises, not from whatever happens to be on disk right now.
function workspaceMemberDirs() {
  const dirs = []
  const vendorGlob = join(vendorAbs, 'vendor')
  for (const name of safeReaddir(vendorGlob)) dirs.push(join(vendorGlob, name))
  const packagesGlob = join(vendorAbs, 'packages')
  for (const group of safeReaddir(packagesGlob)) {
    const groupPath = join(packagesGlob, group)
    for (const name of safeReaddir(groupPath)) dirs.push(join(groupPath, name))
  }
  dirs.push(join(vendorAbs, 'apps', 'cli'), join(vendorAbs, 'apps', 'desktop-host'))
  return dirs
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}

/** Newest mtime (ms) of any file under `dir`, or 0 if `dir` has no files. */
function newestMtimeMs(dir) {
  let newest = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else {
        try {
          newest = Math.max(newest, statSync(path).mtimeMs)
        } catch { /* removed between readdir and stat — ignore */ }
      }
    }
  }
  return newest
}

/**
 * Prove the checkout `pnpm run build:vendor` is about to build is the one
 * `vendorPin` describes — not just recorded as such, but actually on disk in
 * a state that can produce it. Exits the process with a fix command on the
 * first thing that doesn't hold; never mutates anything (CONSTITUTION.md
 * Article VII: a build only trusts a checkout it can prove matches the pin).
 */
function assertBuildEnvironment() {
  if (!existsSync(join(vendorAbs, 'package.json'))) {
    console.error(`[build-vendor] refusing to build: ${vendorDir} is not checked out.\n  Run:\n    git submodule update --init --recursive ${vendorDir}`)
    process.exit(1)
  }

  // Article II's own gate (dirty working tree, pin vs. index, and — as of
  // Article VII — the checkout actually sitting at that pin) is the
  // canonical check; reuse it rather than re-implement it here.
  const pristine = spawnSync('node', [join(repoRoot, 'scripts', 'check-vendor-pristine.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (pristine.status !== 0) {
    console.error('[build-vendor] refusing to build: see check-vendor-pristine above.')
    process.exit(pristine.status ?? 1)
  }

  // The vendor's own `pnpm install` state must be at least as new as what it
  // was installed from. A submodule pin bump can leave `node_modules`
  // installed against the PREVIOUS manifest/lockfile — nothing about moving
  // the pin re-runs `pnpm install`, so a stale install fails deep inside
  // `tsc` (a newly required package genuinely missing) rather than with a
  // clear "reinstall me" message.
  const manifestMtimes = [join(vendorAbs, 'package.json'), join(vendorAbs, 'pnpm-lock.yaml')]
    .filter(existsSync)
    .map(p => statSync(p).mtimeMs)
  const manifestMs = Math.max(...manifestMtimes)
  const modulesYaml = join(vendorAbs, 'node_modules', '.modules.yaml')
  if (!existsSync(modulesYaml) || statSync(modulesYaml).mtimeMs < manifestMs) {
    console.error(
      `[build-vendor] refusing to build: ${vendorDir}/node_modules is missing or older than its own`
      + " package.json/pnpm-lock.yaml — installed against a manifest this checkout has since moved past.\n"
      + '  Run:\n'
      + `    CI=true pnpm --dir ${vendorDir} install --frozen-lockfile`,
    )
    process.exit(1)
  }

  // Stale local state from a PREVIOUS pin. `git checkout`/`submodule update`
  // only touch tracked files, so two things can survive a pin bump that
  // deleted or rebuilt what they came from:
  //   - a workspace-member directory the new pin no longer has upstream, kept
  //     alive only by its own .gitignore'd `node_modules`/`lib` (no
  //     `package.json` — the new pin never shipped one here);
  //   - a `lib/` still holding build output older than this checkout, inside
  //     a directory the new pin DOES still have.
  // Both are silent: nothing about them shows up in `git status` or
  // `check-vendor-pristine`, because none of it is tracked. tsdown's
  // workspace glob still finds these directories on disk, though, and either
  // fails trying to build a package that no longer exists or bundles
  // yesterday's output as if it were fresh.
  const checkoutMarkerMs = statSync(join(vendorAbs, 'package.json')).mtimeMs
  const orphans = []
  const stale = []
  for (const dir of workspaceMemberDirs()) {
    if (!existsSync(dir)) continue
    if (!existsSync(join(dir, 'package.json'))) {
      orphans.push(dir)
      continue
    }
    const libDir = join(dir, 'lib')
    if (existsSync(libDir)) {
      const newest = newestMtimeMs(libDir)
      if (newest > 0 && newest < checkoutMarkerMs) stale.push(libDir)
    }
  }
  if (orphans.length > 0 || stale.length > 0) {
    const rel = p => relative(repoRoot, p)
    const lines = ['[build-vendor] refusing to build: stale local state left over from a previous vendor pin.', '']
    if (orphans.length > 0) {
      lines.push(
        "  Directories the current pin doesn't ship, kept alive only by their own",
        "  .gitignore'd contents (`git checkout` only touches tracked files):",
        ...orphans.map(d => `    ${rel(d)}`),
        '',
      )
    }
    if (stale.length > 0) {
      lines.push(
        '  Build output older than this checkout, left over from a previous pin:',
        ...stale.map(d => `    ${rel(d)}`),
        '',
      )
    }
    const targets = [...orphans, ...stale].map(d => relative(vendorAbs, d)).join(' ')
    lines.push('  Run:', `    git -C ${vendorDir} clean -fdX -- ${targets}`)
    console.error(lines.join('\n'))
    process.exit(1)
  }
}

assertBuildEnvironment()

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
