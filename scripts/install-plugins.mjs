#!/usr/bin/env node
/**
 * Install this repo's plugin bundles into a dsh profile.
 *
 * Nothing here is a second installation path: this is exactly the
 * `dsh plugin --profile <name> add <path>` that CONSTITUTION.md Article I
 * names as the only one, run for you in the documented order instead of by
 * hand. Building a bundle and never installing it is the failure mode this
 * exists to close — a freshly built package that simply never appears in the
 * app, with nothing in the build output to say why.
 *
 * Idempotent: a bundle already in the profile's `dsh.profile.bundles` is left
 * alone, so a rebuild is a no-op once the profile is set up.
 *
 * Order is load-bearing (see ARCHITECTURE.md's "Open items" and each bundle's
 * cordis.patch.yml): `cordis.patch.yml` layers apply in `dsh.profile.bundles`
 * order, so a layer that disables a row must come after whatever inserted it.
 * BUNDLES below is that order. Missing bundles are appended in it; a profile
 * whose existing rows are in a different relative order is reported, not
 * silently reshuffled — `plugin add` cannot reorder, and remove/re-add against
 * a profile someone may be running is not this script's call to make.
 *
 * Skipped entirely when CI is set: a CI build has no ~/.dsh to install into,
 * and `pnpm run build` there must stay a pure repo operation.
 *
 * Usage: node scripts/install-plugins.mjs [--profile <name>] [--dry-run]
 * Honors DSH_HOME the same way `dsh` itself does.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Bundle directories, in the order they must appear in `dsh.profile.bundles`.
 * `packages/terminal/dsh-plugin-terminal` is deliberately not here: unlike
 * the other three, it inserts a row rather than replacing a vendor one, so a
 * profile can drop it from Settings > Plugins and lose nothing this repo
 * otherwise owns — this script must not force it back on a profile whose
 * owner removed it on purpose. Install it by hand where it's wanted:
 * `./dsh plugin --profile <name> add packages/terminal/dsh-plugin-terminal`.
 */
const BUNDLES = [
  'packages/workspace-git/bundle-workspace-git',
  'packages/anthropic-subscription/bundle-anthropic-subscription',
  'packages/mcp-connector/bundle-mcp-connector',
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const profileFlag = args.indexOf('--profile')
const profile = profileFlag === -1 ? 'web' : args[profileFlag + 1]

if (!profile) {
  console.error('install-plugins: --profile needs a name')
  process.exit(1)
}

if (process.env.CI) {
  console.log(`install-plugins: CI set — skipping profile "${profile}" install`)
  process.exit(0)
}

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileManifest = join(dshHome, 'profiles', profile, 'package.json')

/** @returns {string[]} the profile's current bundle list, empty if it has no profile yet. */
function installedBundles() {
  if (!existsSync(profileManifest)) return []
  try {
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    return manifest?.dsh?.profile?.bundles ?? []
  } catch (error) {
    console.error(`install-plugins: could not read ${profileManifest}`)
    throw error
  }
}

/** @returns {string} the `name` a bundle directory's package.json declares. */
function bundleName(dir) {
  return JSON.parse(readFileSync(join(REPO, dir, 'package.json'), 'utf8')).name
}

const wanted = BUNDLES.map((dir) => ({ dir, name: bundleName(dir) }))
const present = installedBundles()
const missing = wanted.filter(({ name }) => !present.includes(name))

if (missing.length === 0) {
  console.log(`install-plugins: profile "${profile}" already has all ${wanted.length} bundles`)
} else {
  for (const { dir, name } of missing) {
    const path = join(REPO, dir)
    const before = installedBundles()
    console.log(`install-plugins: adding ${name} to profile "${profile}"`)
    if (dryRun) continue
    const run = spawnSync(join(REPO, 'dsh'), ['plugin', '--profile', profile, 'add', path], {
      stdio: 'inherit',
      cwd: REPO,
    })
    if (run.status !== 0) {
      console.error(`install-plugins: \`dsh plugin add ${name}\` failed (exit ${run.status ?? 'signal ' + run.signal})`)
      process.exit(run.status ?? 1)
    }
    // `dsh plugin add` reconciles the whole layer list against installed
    // state, and drops any bundle entry whose package it cannot resolve — so
    // one add against a profile with a broken node_modules (a half-finished
    // install, a moved checkout a `link:` dep points at) silently unlists
    // bundles nobody asked to touch. Loud is the only acceptable outcome:
    // the profile has already been rewritten by the time we can see it.
    const after = installedBundles()
    const dropped = before.filter((entry) => !after.includes(entry))
    if (dropped.length > 0) {
      console.error(
        `install-plugins: adding ${name} dropped ${dropped.join(', ')} from profile "${profile}"'s bundle list.\n` +
          'That means `dsh plugin add` could not resolve those packages — check the profile\'s node_modules\n' +
          '(a `link:` dependency pointing at a moved checkout is the usual cause), then re-add them in order:\n' +
          dropped.map((entry) => `  ./dsh plugin --profile ${profile} add <path to ${entry}>`).join('\n'),
      )
      process.exit(1)
    }
    // Exit 0 and no drop is not proof `name` itself landed: `dsh plugin add`
    // can also resolve to a no-op (e.g. a stale lockfile/node_modules that
    // makes the new package invisible to it) without dropping anything else.
    // Silence here is exactly the failure this whole script exists to
    // close — a bundle that never appears in the app with nothing in the
    // build output to say why.
    if (!after.includes(name)) {
      console.error(
        `install-plugins: \`dsh plugin add ${name}\` exited 0 but profile "${profile}"'s bundle list still does not\n` +
          `include it. Check the profile's node_modules for ${name}, then re-add by hand:\n` +
          `  ./dsh plugin --profile ${profile} add ${path}`,
      )
      process.exit(1)
    }
  }
  if (!dryRun) {
    console.log(
      `install-plugins: installed ${missing.length} bundle(s) — restart any running \`dsh --profile ${profile}\` to pick them up`,
    )
  }
}

// Order check, against whatever the profile ends up with.
const final = dryRun ? present : installedBundles()
const ours = wanted.map(({ name }) => name).filter((name) => final.includes(name))
const byProfile = final.filter((name) => ours.includes(name))
if (ours.join('\n') !== byProfile.join('\n')) {
  console.warn(
    `install-plugins: warning: profile "${profile}" lists this repo's bundles as\n` +
      `  ${byProfile.join(', ')}\n` +
      `but their patch layers expect\n  ${ours.join(', ')}\n` +
      'A layer that disables a row must apply after the layer that inserted it. Fix with\n' +
      `  ./dsh plugin --profile ${profile} remove <name>   # then re-add in the order above`,
  )
}
