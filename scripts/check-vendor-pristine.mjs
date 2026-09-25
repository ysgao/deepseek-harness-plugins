#!/usr/bin/env node
// Enforce CONSTITUTION.md Article II: the vendored submodule is never modified.
//
// Article II already named its own check —
//
//   `git -C packages/_vendor/deepseek-harness status --porcelain` must be
//   empty in every commit that touches this repo.
//
// — but nothing executed it, so it was an intention rather than a gate. This
// script is that command, plus the half it could not express.
//
// Three things are checked, because there are three distinct ways the vendor
// stops being the pinned upstream tree:
//
//   1. WORKING TREE. Someone edited a vendored file. `status --porcelain`
//      catches it. This needs the submodule checked out; where it is not (a
//      plain `git worktree add` does not populate submodules), the check is
//      skipped rather than failed — a submodule that is not on disk cannot
//      have been edited.
//
//   2. THE PIN. Someone committed INSIDE the submodule, or checked out a
//      different revision, and the gitlink now points somewhere else. That
//      dirties nothing a `status` in the vendor would report, so it needs its
//      own check: the gitlink recorded in this repo's index must equal
//      `vendorPin` in scripts/replacement-parity.json — the revision every
//      fork hash in that file was recorded against. Reading the INDEX rather
//      than the vendor's own HEAD is deliberate: it is what a commit would
//      actually record, and it works even when the submodule is absent.
//
//   3. THE CHECKOUT. The index can already say `vendorPin` while the
//      submodule's own working tree still sits on an older commit — `git
//      submodule update`/`checkout` is what moves it there, and nothing
//      forces that step to have run. Checks 1 and 2 both pass in this state:
//      the vendor's own `status` is clean (there is nothing uncommitted to
//      report), and the index gitlink already matches `vendorPin` (it was
//      updated in the pin-bump commit, same as always). What's missing is a
//      check that the files actually on disk are the files at that pin —
//      `git -C packages/_vendor/deepseek-harness rev-parse HEAD` must equal
//      `vendorPin` too. Skipped alongside check 1 when the submodule isn't
//      checked out, for the same reason.
//
// A pin bump is a legitimate change, and it stays legitimate here: bumping the
// submodule and updating `vendorPin` in the same commit is exactly what
// CONSTITUTION.md's "a commit that moves the submodule pin" procedure already
// requires. This check simply refuses to let any of the three drift apart
// silently.
//
// Usage: node scripts/check-vendor-pristine.mjs
// Exit 0 = pristine (or not checked out); exit 1 = Article II violated.
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join('packages', '_vendor', 'deepseek-harness')
const VENDOR_ABS = join(REPO, VENDOR)

// Git exports these to its hooks. They must NOT leak into the calls we make
// about the submodule: with GIT_DIR inherited and GIT_WORK_TREE unset, git
// treats our cwd as the work tree, so asking the (empty) vendor directory for
// its status compares the superproject's index against an empty tree and
// reports every tracked file in this repo as deleted. Found exactly that way —
// the first run of this hook blocked its own commit.
const GIT_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

/**
 * Run git, returning trimmed stdout, or undefined if it failed.
 *
 * `inherited` keeps git's ambient environment, which is what we want for
 * questions about THIS repo during a hook — the index being committed is the
 * one the hook was handed. Vendor questions pass false so git rediscovers the
 * submodule from its own directory.
 */
function git(args, { cwd = REPO, inherited = true } = {}) {
  const env = { ...process.env }
  if (!inherited) for (const name of GIT_ENV_VARS) delete env[name]
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return undefined
  return result.stdout.trim()
}

/** Canonical path, or undefined if it does not exist. */
function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * The `git()` options for running commands against the vendor's own
 * repository, or undefined when the submodule is not checked out here. The
 * guard matters: `git -C <empty dir> status` does NOT fail, it walks UP to
 * the superproject and reports THIS repo's files, which would read as "the
 * vendor is dirty" for every unrelated edit. So only trust a context whose
 * toplevel really is the vendor directory.
 */
function vendorGitContext() {
  const vendorReal = real(VENDOR_ABS)
  if (vendorReal === undefined) return undefined
  const where = { cwd: VENDOR_ABS, inherited: false }
  const toplevel = git(['rev-parse', '--show-toplevel'], where)
  if (toplevel === undefined || real(toplevel) !== vendorReal) return undefined
  return where
}

const problems = []
const parityPath = join(REPO, 'scripts', 'replacement-parity.json')
const pinned = JSON.parse(readFileSync(parityPath, 'utf8')).vendorPin

// 1 and 3 both need the vendor's own git context (undefined when the
// submodule is not checked out in this working tree, which skips both).
const vendorWhere = vendorGitContext()
if (vendorWhere === undefined) {
  console.log(`check-vendor-pristine: ${VENDOR} is not checked out — skipping the working-tree and checkout checks`)
} else {
  // 1. Working tree. Article II's own command, verbatim.
  const status = git(['status', '--porcelain'], vendorWhere)
  if (status === undefined) {
    problems.push(`could not read \`git status\` for ${VENDOR}`)
  } else if (status !== '') {
    problems.push(
      'the vendor working tree is dirty (Article II: it must be empty in every commit):\n'
      + status.split('\n').map(line => `      ${line}`).join('\n')
      + '\n    Revert it — never commit it. What you wanted probably belongs in'
      + "\n    this repo's own packages, via Article III (a replacement).",
    )
  }

  // 3. The checkout. The submodule's own on-disk HEAD must be the pinned
  //    commit, not just recorded as such in the index (check 2, below) — a
  //    `submodule update`/`checkout` that never ran leaves this mismatched
  //    while checks 1 and 2 both read clean.
  const head = git(['rev-parse', 'HEAD'], vendorWhere)
  if (head === undefined) {
    problems.push(`could not read \`git rev-parse HEAD\` for ${VENDOR}`)
  } else if (head !== pinned) {
    problems.push(
      "the vendor working tree is checked out at a commit other than vendorPin — it was pinned but never actually moved there:"
      + `\n      HEAD:      ${head}`
      + `\n      vendorPin: ${pinned}`
      + '\n    Run:'
      + `\n      git submodule update --init --recursive ${VENDOR}`,
    )
  }
}

// 2. The pin. Compare the gitlink this repo's index would commit against the
//    revision replacement-parity.json says every fork hash was read at.
const staged = git(['rev-parse', `:${VENDOR}`])
if (staged === undefined) {
  problems.push(`could not read the submodule gitlink for ${VENDOR} from the index`)
} else if (staged !== pinned) {
  problems.push(
    'the submodule pin moved without scripts/replacement-parity.json following it:'
    + `\n      index:     ${staged}`
    + `\n      vendorPin: ${pinned}`
    + '\n    A pin bump is allowed, but it is only finished when the parity file is'
    + "\n    updated in the SAME commit — see CONSTITUTION.md's pin-bump procedure"
    + '\n    (re-read every fork against its moved original, then re-record hashes).',
  )
}

if (problems.length > 0) {
  console.error('check-vendor-pristine: FAILED\n')
  for (const problem of problems) console.error(`  - ${problem}\n`)
  process.exit(1)
}

console.log(`check-vendor-pristine: ${VENDOR} is pristine at ${pinned.slice(0, 12)}`)
