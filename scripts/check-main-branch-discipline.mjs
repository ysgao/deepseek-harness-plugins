#!/usr/bin/env node
// Enforce CONSTITUTION.md Article VI: `main` only ever holds a state that has
// actually been built and booted, so all development happens on a branch —
// with one narrow, mechanically-decidable exception for changes that cannot
// affect what gets built or run at all.
//
// Article VI already named that rule ("all development happens on a branch
// ... never by committing to main directly"), but nothing executed it, so it
// was an intention rather than a gate — exactly the gap Article II closed for
// the vendor with check-vendor-pristine.mjs. This script is the same move
// applied to Article VI: it cannot verify a human actually ran the
// build/boot checkpoint before a branch merges (no hook can prove that), but
// it CAN verify, from the staged diff alone, whether a commit about to land
// on `main` is carrying anything beyond documentation. That half is worth
// gating even though the other half still needs discipline.
//
// The exception this script also enforces — a commit whose every staged path
// is documentation may go straight to `main` — exists because such a commit
// is provably incapable of changing what `pnpm run build` produces or what
// boots. DOC_ONLY_PATTERNS below is the ONE place that boundary is defined;
// CONSTITUTION.md's Article VI deliberately does not restate it, so the rule
// and the check that enforces it cannot drift apart the way a rule stated in
// two places always eventually does.
//
// Usage: node scripts/check-main-branch-discipline.mjs
// Exit 0 = not on `main`, or every staged path is doc-only.
// Exit 1 = on `main` with a staged path outside DOC_ONLY_PATTERNS.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_BRANCH = 'main'

/**
 * A staged path is doc-only when it matches one of these. Each entry is a
 * predicate over the path as git reports it: `/`-separated, relative to the
 * repo root. Keep this list narrow — it is the whole definition of "cannot
 * break the app" that Article VI's exception relies on. Widening it is
 * itself a change to what the constitution permits onto `main` unreviewed,
 * and earns the same scrutiny as any other amendment.
 */
const DOC_ONLY_PATTERNS = [
  // Prose. Nothing under packages/**, scripts/**, or any build/tool config
  // ends in these, so this cannot silently swallow a code change.
  path => /\.mdx?$/i.test(path),
  path => /\.txt$/i.test(path),
  // Licence files: `LICENSE`, `LICENSE.md`, `LICENSE-MIT`, etc.
  path => /^LICENSE([.\-].*)?$/i.test(path.split('/').pop() ?? ''),
]

function isDocOnly(path) {
  return DOC_ONLY_PATTERNS.some(test => test(path))
}

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return undefined
  return result.stdout
}

const branchRaw = git(['rev-parse', '--abbrev-ref', 'HEAD'])
const branch = branchRaw?.trim()
if (branch === undefined) {
  console.error('check-main-branch-discipline: could not determine the current branch — refusing to guess')
  process.exit(1)
}

if (branch !== MAIN_BRANCH) {
  // Article VI's whole point is that non-doc work happens off `main`. A
  // branch is exactly where it belongs; nothing to enforce here.
  process.exit(0)
}

const stagedRaw = git(['diff', '--cached', '--name-only'])
if (stagedRaw === undefined) {
  console.error('check-main-branch-discipline: could not read staged paths')
  process.exit(1)
}

const staged = stagedRaw.split('\n').map(line => line.trim()).filter(line => line.length > 0)
if (staged.length === 0) {
  process.exit(0) // nothing staged — e.g. an empty/--allow-empty commit
}

const offenders = staged.filter(path => !isDocOnly(path))

if (offenders.length > 0) {
  const branchNameHint = 'feat/<slug>  (or fix/<slug>, docs/<slug> — matching the rest of this repo\'s history)'
  console.error('check-main-branch-discipline: FAILED\n')
  console.error(`  This commit is staged directly on \`${MAIN_BRANCH}\`, and it touches something`)
  console.error('  beyond documentation, which CONSTITUTION.md Article VI does not allow:\n')
  for (const path of offenders) console.error(`      ${path}`)
  console.error('\n  Move this work to a branch instead — nothing is lost, the change is still')
  console.error('  staged:')
  console.error(`\n      git checkout -b ${branchNameHint}`)
  console.error('      git commit\n')
  console.error('  Build and boot-test the branch (ARCHITECTURE.md "Testing procedures"), then')
  console.error('  merge it back to main locally once it works — see CONSTITUTION.md Article VI.')
  console.error('\n  (A commit whose every path is documentation — .md/.txt, or a LICENSE file —')
  console.error('  is exempt and may go straight to main; see DOC_ONLY_PATTERNS in this script.)')
  process.exit(1)
}

console.log(`check-main-branch-discipline: doc-only commit on ${MAIN_BRANCH} — allowed (${staged.length} path${staged.length === 1 ? '' : 's'})`)
