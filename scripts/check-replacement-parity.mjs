#!/usr/bin/env node
/**
 * Replacement-parity check — the mechanical half of the rule in
 * `CONSTITUTION.md` ("A replacement never subtracts") and
 * `ARCHITECTURE.md`'s "Replacement parity".
 *
 * Three of this repo's packages do not extend the vendored harness, they
 * *replace* one of its plugin rows: `cordis.patch.yml` sets `disabled: true`
 * on a vendor row and inserts an out-of-tree package in its place. The row
 * that is switched off takes every one of its own contributions with it, so
 * anything the replacement fails to re-register is not "not enhanced yet" —
 * it is a feature the user had before the bundle was installed and does not
 * have after. A vendor pin bump is where that silently happens: upstream adds
 * a slot, a locale key, a service, or edits a file this repo forked, and
 * nothing in a type-clean build notices the replacement stayed behind.
 *
 * What this checks, per replacement declared in `replacement-parity.json`:
 *
 *   1. ROW      — the disabled row id is really disabled in the bundle patch,
 *                 the replacement is really inserted there, and that row id
 *                 still exists in a vendored bundle (a renamed row upstream
 *                 makes `disabled: true` a silent no-op, which is worse than
 *                 an error: both plugins then register the same slots).
 *   2. INJECT   — the replacement's `inject` array covers the vendor plugin's,
 *                 so it cannot activate in a composition the original would
 *                 have refused to activate in.
 *   3. SLOTS    — every `name:`/`id:` slot registration literal in the vendor
 *                 plugin's apply appears in the replacement's apply.
 *   4. LOCALE   — the replacement's copy dictionary is a superset of the
 *                 vendor dictionary it stands in for, key for key.
 *   5. FORK     — every vendor file this repo forked still hashes to the
 *                 revision the fork was last synced against. A mismatch is
 *                 the pin bump saying "re-read this file and port what
 *                 changed", and is cleared by re-forking and re-recording the
 *                 hash with `--update`.
 *
 * It is deliberately textual, not semantic: it cannot prove a forked React
 * component still renders every branch the original did. Check 5 is what
 * covers that — it refuses to go green while a forked file's original has
 * moved, which forces the human read that no regex substitutes for.
 *
 * Usage:
 *   node scripts/check-replacement-parity.mjs [--root <repo>] [--update]
 *
 *   --root    repository to check (default: this script's own repo root) —
 *             useful from a worktree, where the submodule isn't checked out.
 *   --update  after a deliberate resync, rewrite the recorded vendor hashes
 *             instead of failing on them (`vendorPin` is updated by hand).
 *             Never run this to "fix" a red check without having actually
 *             re-forked the files.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const rootFlag = args.indexOf('--root')
const ROOT = rootFlag === -1 ? resolve(HERE, '..') : resolve(args[rootFlag + 1])
const UPDATE = args.includes('--update')
const MANIFEST = join(HERE, 'replacement-parity.json')
const VENDOR = 'packages/_vendor/deepseek-harness'

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const failures = []

// A worktree has no submodule checkout, so every vendor read would fail as a
// "missing file" and bury the real signal. Say what's actually wrong instead.
if (!existsSync(join(ROOT, VENDOR, 'packages'))) {
  console.error(
    `the vendored harness is not checked out under ${ROOT}\n`
    + '  run this from the primary checkout, or pass --root <path to it>.')
  process.exit(2)
}

/** Read a repo-relative file, or fail the run naming what is missing. */
function read(rel) {
  const path = join(ROOT, rel)
  if (!existsSync(path)) {
    failures.push(`missing file: ${rel}`)
    return undefined
  }
  return readFileSync(path, 'utf8')
}

/** Every string literal assigned to `key:` in a source file. */
function literals(source, key) {
  return new Set(
    [...source.matchAll(new RegExp(`\\b${key}:\\s*'([^']+)'`, 'g'))].map(m => m[1]))
}

/** The `export const inject = [...]` service names of a plugin entry. */
function injectNames(source) {
  const block = /export const inject\s*=\s*\[([^\]]*)\]/s.exec(source)
  if (block === null) return undefined
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]))
}

/**
 * Top-level keys of an exported dictionary object literal. Matches both forms
 * these files use: a bare `export const en = {` and the type-annotated
 * `export const zh: { [Key in keyof typeof en]: string } = {`.
 */
function dictionaryKeys(source, name) {
  const opening = new RegExp(`^export const ${name}\\b[^\\n]*= \\{$`, 'm').exec(source)
  if (opening === null) return undefined
  const body = source.slice(opening.index)
  const end = body.indexOf('\n}')
  return new Set(
    [...body.slice(0, end).matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map(m => m[1]))
}

/** Members of `a` that `b` lacks. */
const missing = (a, b) => [...a].filter(entry => !b.has(entry))

/** 1. The bundle patch really disables the row, and the row really exists. */
function checkRow(entry) {
  const patch = read(entry.bundlePatch)
  if (patch === undefined) return
  const disables = new RegExp(`- id: ${entry.row}\\s*\\n\\s*disabled: true`).test(patch)
  if (!disables) {
    failures.push(`[${entry.row}] ${entry.bundlePatch} does not disable it`)
  }
  if (!patch.includes(entry.replacementPlugin)) {
    failures.push(`[${entry.row}] ${entry.bundlePatch} does not insert ${entry.replacementPlugin}`)
  }
  const bundles = join(ROOT, VENDOR, 'packages/bundle')
  const owners = readdirSync(bundles).filter((name) => {
    const file = join(bundles, name, 'cordis.patch.yml')
    return existsSync(file)
      && new RegExp(`- id: ${entry.row}\\s*\\n\\s*name: '${entry.vendorPlugin}'`)
        .test(readFileSync(file, 'utf8'))
  })
  if (owners.length === 0) {
    failures.push(
      `[${entry.row}] no vendored bundle mounts this row as '${entry.vendorPlugin}' any more — `
      + 'the disable is now a silent no-op and both plugins will register the same slots')
  }
}

/** 2-4. The replacement's plugin surface covers the row it stands in for. */
function checkSurface(entry) {
  const vendorApply = read(join(entry.vendorPackage, entry.vendorApply))
  const forkApply = read(join(entry.replacementPackage, entry.replacementApply))
  if (vendorApply === undefined || forkApply === undefined) return

  const vendorInject = injectNames(vendorApply)
  const forkInject = injectNames(forkApply)
  if (vendorInject !== undefined && forkInject !== undefined) {
    const gap = missing(vendorInject, forkInject)
    if (gap.length > 0) failures.push(`[${entry.row}] inject missing: ${gap.join(', ')}`)
  }

  for (const key of ['name', 'id']) {
    const gap = missing(literals(vendorApply, key), literals(forkApply, key))
    if (gap.length > 0) {
      failures.push(`[${entry.row}] slot ${key} registered by the vendor plugin but not the replacement: ${gap.join(', ')}`)
    }
  }

  if (entry.locale === undefined) return
  const vendorLocale = read(entry.locale.vendor)
  const forkLocale = read(entry.locale.replacement)
  if (vendorLocale === undefined || forkLocale === undefined) return
  for (const dictionary of entry.locale.dictionaries) {
    const vendorKeys = dictionaryKeys(vendorLocale, dictionary)
    const forkKeys = dictionaryKeys(forkLocale, dictionary)
    if (vendorKeys === undefined || forkKeys === undefined) {
      failures.push(`[${entry.row}] locale dictionary '${dictionary}' not found in both files`)
      continue
    }
    const gap = missing(vendorKeys, forkKeys)
    if (gap.length > 0) {
      failures.push(`[${entry.row}] locale '${dictionary}' missing keys: ${gap.join(', ')}`)
    }
  }
}

/** 5. Every forked file's vendor original still hashes to the synced revision. */
function checkForks(entry) {
  for (const fork of entry.forks) {
    const source = read(fork.vendor)
    if (source === undefined) continue
    const digest = createHash('sha256').update(source).digest('hex').slice(0, 16)
    if (UPDATE) { fork.sha256 = digest; continue }
    if (fork.sha256 !== digest) {
      failures.push(
        `[${entry.row}] vendor original changed since the last resync: ${fork.vendor}\n`
        + `    re-read it against the fork (${fork.fork}), port what changed, then `
        + 'record the new hash with --update')
    }
  }
}

for (const entry of manifest.replacements) {
  checkRow(entry)
  checkSurface(entry)
  checkForks(entry)
}

// Fork-only packages disable no vendor row, so checks 1-4 have nothing to
// judge — but check 5 still applies, and is the one that carries the weight.
// A package that forks a vendor FILE without replacing its plugin row (see
// `dsh-plugins-mcp-client-oauth`, which forks the mcp-client connection
// supervisor purely to add a transport case) would otherwise drift silently
// across a pin bump, which is exactly the failure this whole script exists to
// prevent.
for (const entry of manifest.forkOnly ?? []) {
  checkForks({ ...entry, row: entry.package })
}

if (UPDATE) {
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `recorded current vendor hashes into ${MANIFEST} — `
    + 'update `vendorPin` by hand to the commit they were read from')
}

if (failures.length > 0) {
  console.error(`\nreplacement parity: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('\nSee ARCHITECTURE.md "Replacement parity" for what each check means.\n')
  process.exit(1)
}
console.log(
  `replacement parity: ${manifest.replacements.length} replacement(s) OK`
  + `, ${String((manifest.forkOnly ?? []).length)} fork-only package(s) OK`)
