#!/usr/bin/env node
/**
 * Deploy one workspace package into a standalone, self-contained directory
 * using pnpm's own builtin `pnpm deploy` — no git clone, no rebuild, no
 * network. Every dependency is a real file (hard-linked from the local
 * content-addressable store), not a symlink back into this checkout, so
 * editing source here afterward cannot affect a directory this produced.
 *
 * Why `--legacy`: pnpm 10+'s default (non-legacy) deploy implementation
 * requires `injectWorkspacePackages: true` in pnpm-workspace.yaml, and even
 * with that set it was verified here to (a) make real `registry.npmjs.org`
 * requests despite `--offline` — a hard no for a fully-local, no-registry
 * deploy — and (b) print its own "please add forceLegacyDeploy: true"
 * fallback advice on a shared-lockfile workspace this size. `--legacy` was
 * verified to complete fully offline (`--offline` genuinely enforced, zero
 * registry requests).
 *
 * The tradeoff `--legacy` has instead: it does not replicate a
 * package-local peer-dependency hoist — many packages here declare a peer
 * like `@deepseek-ai/cordis-plugin-group` or `@deepseek-ai/dsh-jobs`,
 * satisfied in the source workspace by a hoist scoped to the *consuming*
 * package's own `node_modules`, which `--legacy` deploy's closure
 * computation does not walk. Deploying `@deepseek-ai/dsh` (the CLI engine
 * plus its `web` profile's full default feature set) surfaced upward of 30
 * such gaps, cascading three levels deep as each backfilled package's own
 * further peers came to light.
 *
 * `main`'s boot-probe loop below closes every gap mechanically instead of
 * hardcoding package names: boot the deployed target for real (both a fatal
 * "N required plugins did not activate" and a non-fatal "N entries did not
 * activate" warning are handled — the latter names no underlying error, so
 * that package is re-imported directly, in place, purely to surface its own
 * `ERR_MODULE_NOT_FOUND`), and for every missing package M found, resolve
 * M's real source directory and copy it into the deployed target's own
 * top-level `node_modules`, then retry — up to 20 rounds, since backfilling
 * M can surface M's own further-missing peers.
 *
 * M's real directory comes from one of two places. Most commonly M is
 * itself a workspace member (root and vendor are one folded pnpm workspace
 * — ARCHITECTURE.md's "Dependency source"), named directly by `pnpm list
 * --filter=M --depth -1 --json` (deliberately not `pnpm exec`, which runs a
 * deps-status check that can itself try to reinstall). Occasionally M is a
 * genuine third-party dependency (verified case: `zod`) that is not a
 * workspace member and not reachable from this repo's own root (most
 * packages have no direct dependency on it there either) — resolved instead
 * from a real file placed inside the *consuming* package's own directory,
 * where the normal dev install already makes M resolvable.
 *
 * Usage:
 *   node scripts/pnpm-deploy.mjs <pnpm-package-name> <target-dir> [--dev]
 *
 * `--dev` keeps devDependencies (default: production-only, i.e. `--prod`).
 *
 * A boot that is *going to fail* only prints its final summary after
 * attempting every configured plugin — verified here to take 30+ seconds
 * cold, well past a short fixed timeout. `bootProbe` therefore polls
 * `combined` output for one of two *definite* terminal signals (the real
 * `dsh web: http://` success line, or any of `startup failed`/`entries did
 * not activate`/`Full diagnostics:`) rather than assuming success once
 * nothing crashed within an arbitrary window — killing the process and
 * reading empty output before its failure summary ever printed was a real,
 * verified false-positive this earlier produced. The failure check runs
 * *before* the success check for the same reason: a non-fatal warning and
 * the success line can both be present in the same run's output (the
 * server starts fine with some optional plugins silently broken), and
 * checking success first would resolve `ok: true` and never notice.
 *
 * Verified end to end: `@deepseek-ai/dsh` deploys, cascades through ~30
 * backfills across 10 boot-probe rounds, and then boots clean (a real
 * listening server, `curl` gets a real HTTP response) with zero warnings;
 * each of this repo's own `dsh-plugins-bundle-*` packages (including the
 * optional `dsh-plugin-terminal`) deploys cleanly with no backfill needed
 * at all. Two of those deployed bundles were then `dsh plugin add`ed into a
 * profile booted against the deployed engine above, and confirmed to
 * activate for real: `dsh-plugin-terminal` logs its own "host half active"
 * line, and `dsh-plugins-bundle-workspace-git`'s row-replacement composed
 * correctly (`--dump-config` shows vendor's `ui-workspace` row `disabled:
 * true`, annotated "patched by dsh-plugins-bundle-workspace-git", with the
 * replacement `workspace-enhanced` row present) — not just "didn't crash".
 *
 * One residual, low-risk artifact: pnpm's own virtual store keeps one
 * internal self-referential symlink (`node_modules/.pnpm/node_modules/
 * <deployed-pkg-name>`) pointing back at this checkout for the deployed
 * package itself — never traversed by anything that actually runs (the
 * deployed package's real, loaded content is the plain top-level files
 * `pnpm deploy` already wrote), so it does not reintroduce the dev-source
 * coupling this script exists to remove.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  console.error('Usage: node scripts/pnpm-deploy.mjs <pnpm-package-name> <target-dir> [--dev]')
}

const [, , pkgName, targetArg, ...rest] = process.argv
if (!pkgName || !targetArg) {
  usage()
  process.exit(1)
}
const target = resolve(process.cwd(), targetArg)
const prodFlag = rest.includes('--dev') ? [] : ['--prod']

/** Runs `pnpm --filter=<pkgName> deploy <target> --legacy --offline [--prod]` from this repo's root. */
function runDeploy() {
  console.log(`pnpm-deploy: deploying ${pkgName} -> ${target}`)
  const args = [`--filter=${pkgName}`, 'deploy', target, '--legacy', '--offline', ...prodFlag]
  const res = spawnSync('pnpm', args, { cwd: REPO_ROOT, stdio: 'inherit' })
  if (res.status !== 0) {
    console.error(`pnpm-deploy: \`pnpm ${args.join(' ')}\` exited ${res.status ?? `signal ${res.signal}`}`)
    process.exit(res.status ?? 1)
  }
}

/**
 * Directly imports `pkgName` from inside `target/lib` (a real file next to
 * `bin.js`, so bare-specifier resolution walks `target`'s own node_modules
 * tree exactly as `bin.js` itself would) purely to surface the real
 * underlying `ERR_MODULE_NOT_FOUND` a non-fatal "failed to import" warning
 * otherwise gives no detail for. Returns `null` when the import genuinely
 * succeeds standalone (the failure has some other, non-missing-module cause
 * this tool cannot fix) or names no missing package.
 */
function diagnoseImport(pkgName) {
  const probePath = join(target, 'lib', `__pnpm_deploy_diagnose_${Date.now()}.mjs`)
  writeFileSync(probePath, `import(${JSON.stringify(pkgName)}).catch((e) => { console.error(e.message); process.exitCode = 1 })\n`)
  try {
    const res = spawnSync('node', [probePath], { encoding: 'utf8' })
    const m = /Cannot find package '([^']+)' imported from (\S+)/.exec(res.stderr || '')
    return m ? { missing: m[1], importedFrom: m[2] } : null
  } finally {
    rmSync(probePath, { force: true })
  }
}

/**
 * Boots `<target>/lib/bin.js` against a throwaway `DSH_HOME`/profile just far
 * enough to prove every plugin's static imports resolve, without needing a
 * real model key or a listening port to stay up.
 *
 * dsh's own app-boot catches every plugin's import failure individually and
 * prints one combined "N plugins did not activate" summary rather than
 * throwing on the first one (this is CONSTITUTION.md Article V's own
 * "a plugin's failure must fail loudly ... not take down dsh" applied to
 * import failures too) — so a single boot attempt can surface many missing
 * modules at once, not just one. This reads the run's own "Full diagnostics"
 * log (named in its stdout) for every `Cannot find package 'X' imported from
 * Y` it recorded, rather than pattern-matching the summary table, which
 * names failed plugins, not the missing packages underneath them.
 *
 * Returns `{ ok: true }` once the process either starts serving or fails for
 * a reason with no missing-module evidence, or `{ ok: false, missing: Map<string,
 * string> }` (module name -> one example "imported from" path) otherwise.
 */
async function bootProbe() {
  const bin = join(target, 'lib', 'bin.js')
  if (!existsSync(bin)) return { ok: true } // not the CLI package; nothing to boot-probe
  const scratchHome = mkdtempSync(join(tmpdir(), 'pnpm-deploy-boot-'))
  const child = spawn('node', [bin, '--profile', 'probe', '--from-default-profile', 'web', '--port', '0', '--no-open'], {
    cwd: target,
    env: { ...process.env, DSH_HOME: scratchHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let combined = ''
  child.stdout.on('data', (chunk) => {
    combined += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    combined += String(chunk)
  })
  /**
   * A fatal boot failure's "Full diagnostics: <path>" log has every failing
   * plugin's full stack trace. A *non-fatal* "N entries did not activate"
   * warning (the server still starts and serves) prints neither a
   * diagnostics path nor the underlying error — only `<id> (<package>):
   * failed to import` — so a warning-listed package with no direct
   * `Cannot find package` evidence anywhere gets re-imported directly
   * (`diagnoseImport`, a plain `node -e "import(pkg)"` run from inside
   * `target/lib`) purely to surface *its* real underlying error the same
   * way a fatal failure's own diagnostics log already does.
   */
  function extractMissing() {
    const diagMatch = /Full diagnostics: (\S+)/.exec(combined)
    const diagText = diagMatch && existsSync(diagMatch[1]) ? readFileSync(diagMatch[1], 'utf8') : ''
    const missing = new Map()
    for (const text of [combined, diagText]) {
      for (const m of text.matchAll(/Cannot find package '([^']+)' imported from (\S+)/g)) {
        if (!missing.has(m[1])) missing.set(m[1], m[2])
      }
    }
    if (missing.size === 0) {
      for (const m of combined.matchAll(/\(([^)]+)\): failed to import/g)) {
        const direct = diagnoseImport(m[1])
        if (direct) missing.set(direct.missing, direct.importedFrom)
      }
    }
    return missing
  }
  // A boot that is *going to fail* only prints its "N plugins did not
  // activate"/"Full diagnostics" summary after attempting every configured
  // plugin — verified here to take 30+ seconds cold (each failed resolution
  // walks a real directory tree before giving up), well past what a short
  // fixed timeout allows. Killing the process before that summary ever
  // prints reads `combined` as empty and falsely declares success — a real
  // false-positive this once produced. So this polls for one of two
  // *definite* terminal signals instead of guessing a fixed duration: the
  // real success line (`dsh web: http://`, printed as soon as the server
  // actually starts listening — no reason to wait any longer once seen) or
  // any failure signal (`startup failed` / `entries did not activate` /
  // `Full diagnostics`). Only past a long last-resort ceiling with neither
  // ever seen does this give up and report failure (empty `missing`) rather
  // than assume success — an honest "something is wrong and this tool
  // cannot tell you what" beats a silent false pass.
  const result = await new Promise((resolvePromise) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      if (ok) {
        resolvePromise({ ok: true })
        return
      }
      const missing = extractMissing()
      resolvePromise({ ok: false, missing })
    }
    const killAndFinish = (ok) => {
      child.kill('SIGTERM')
      // `combined` is built by async 'data' handlers; reading it synchronously
      // right after kill() can still race a just-flushed final write. A short
      // settle delay is enough once a terminal line has already been seen.
      setTimeout(() => finish(ok), 500)
    }
    const poll = setInterval(() => {
      // Checked in this order deliberately: a *non-fatal* "N entries did not
      // activate" warning prints on the same successful run that goes on to
      // print "dsh web: http://" moments later (verified case: the server
      // starts fine with 3 optional plugins silently broken) — checking
      // success first would resolve `ok: true` and never notice. Treating
      // "warning present" as failure here, regardless of whether the success
      // line has also appeared yet, is what makes the boot-probe loop close
      // those gaps too, not just fatal ones.
      if (/startup failed|entries did not activate|Full diagnostics:/.test(combined)) {
        clearInterval(poll)
        killAndFinish(false)
      } else if (/dsh web: http/.test(combined)) {
        clearInterval(poll)
        killAndFinish(true)
      }
    }, 500)
    const ceiling = setTimeout(() => {
      clearInterval(poll)
      killAndFinish(false) // neither signal ever appeared — report failure, not a guessed success
    }, 90_000)
    child.once('exit', () => {
      clearInterval(poll)
      clearTimeout(ceiling)
      finish(false) // exited before either signal; extractMissing() may still find evidence
    })
  })
  rmSync(scratchHome, { recursive: true, force: true })
  return result
}

/**
 * Returns the real source directory pnpm's own workspace resolution has for
 * `pkgName`, or `null` if it isn't a workspace member. Uses `pnpm list
 * --depth -1 --json` deliberately, never `pnpm exec` — the latter runs a
 * deps-status check that can try to reinstall (verified here: it once tried
 * `pnpm install --production` and aborted only because no TTY was present
 * to confirm purging `node_modules`). `list` only reads already-resolved
 * workspace metadata.
 */
function workspacePackageDir(pkgName) {
  const res = spawnSync('pnpm', ['list', `--filter=${pkgName}`, '--depth', '-1', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (res.status !== 0) return null
  try {
    const parsed = JSON.parse(res.stdout)
    return parsed[0]?.path ?? null
  } catch {
    return null
  }
}

/**
 * Extracts the package name whose own `node_modules` lookup chain
 * `importedFrom` sits inside — the last `@scope/name` (or bare name)
 * segment right after a final `/node_modules/` — regardless of whether
 * `importedFrom` sits inside a `.pnpm` virtual-store entry (this repo's own
 * node_modules) or a flat top-level entry (something `backfill` already
 * copied straight into the deployed target).
 */
function consumerPackageName(importedFrom) {
  const idx = importedFrom.lastIndexOf('/node_modules/')
  if (idx === -1) return null
  const after = importedFrom.slice(idx + '/node_modules/'.length)
  const segments = after.split('/')
  return segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

/**
 * Fallback for a genuine third-party dependency (verified case: `zod`,
 * pulled in transitively by a `./typert`-exporting package — see
 * ARCHITECTURE.md's "Dependency source" — but not itself a workspace
 * member, so `workspacePackageDir` correctly returns `null` for it).
 *
 * Resolves `pkgName` from a real file placed inside `fromDir` — deliberately
 * *not* `REPO_ROOT` unconditionally: `REPO_ROOT` itself has no direct
 * dependency on most packages (the same phantom-dependency fact
 * `workspacePackageDir` exists to route around for workspace members), so a
 * third-party package only reachable as *someone else's* dependency needs
 * probing from that someone else's own real directory, not this repo's
 * root — then walks up from the resolved entry file to the nearest
 * `node_modules/<pkg>` ancestor, the real installed package directory to
 * copy, exactly as `workspacePackageDir` gives for a workspace member.
 */
function nodeModulesPackageDir(pkgName, fromDir) {
  const probePath = join(fromDir, `__pnpm_deploy_probe_${Date.now()}.mjs`)
  writeFileSync(probePath, `console.log(import.meta.resolve(${JSON.stringify(pkgName)}))\n`)
  let resolvedPath
  try {
    const res = spawnSync('node', [probePath], { encoding: 'utf8' })
    if (res.status !== 0 || !res.stdout.trim()) return null
    resolvedPath = fileURLToPath(res.stdout.trim().split('\n').pop())
  } finally {
    rmSync(probePath, { force: true })
  }
  const idx = resolvedPath.lastIndexOf('/node_modules/')
  if (idx === -1) return null
  const after = resolvedPath.slice(idx + '/node_modules/'.length)
  const segments = after.split('/')
  const pkgDirName = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return join(resolvedPath.slice(0, idx), 'node_modules', pkgDirName)
}

const TAR_MAX_BUFFER = 1024 * 1024 * 512 // 512 MiB — a source package's own tree easily exceeds spawnSync's 1 MiB default

/**
 * Copies `missing`'s real source directory (workspace member, or third-
 * party dependency of whatever imported it — see `workspacePackageDir` and
 * `nodeModulesPackageDir` above) into `<target>/node_modules/<missing>`, so
 * every importer at any depth inside `target` finds it via Node's normal
 * upward `node_modules` search.
 */

function backfill(missing, importedFrom) {
  let srcDir = workspacePackageDir(missing)
  if (!srcDir) {
    const consumerName = consumerPackageName(importedFrom)
    const consumerDir = consumerName ? workspacePackageDir(consumerName) : null
    srcDir = consumerDir ? nodeModulesPackageDir(missing, consumerDir) : null
  }
  if (!srcDir) {
    console.error(`pnpm-deploy: "${missing}" (imported from ${importedFrom}) is not resolvable as a workspace member or as its importer's own third-party dependency`)
    return false
  }
  const dest = join(target, 'node_modules', missing)
  console.log(`pnpm-deploy: backfilling ${missing}: ${srcDir} -> ${dest}`)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  // Deliberately excludes `srcDir`'s own nested `node_modules`: a source
  // workspace package's local peer-dependency hoist can be a *cyclic*
  // symlink chain (verified case: cordis-plugin-group -> cordis-plugin-
  // loader -> cordis -> cordis-plugin-include -> cordis-plugin-loader),
  // which both `fs.cpSync` (`EINVAL`) and plain `cp -L` (infinite descent)
  // choke on. Excluding it is also correct, not just a workaround: `missing`
  // is being copied so it resolves from the *deployed target's own*
  // node_modules; its own dependencies should already be there from the
  // main deploy's closure (the same `.pnpm` store), and if one genuinely
  // isn't, the boot-probe loop backfills that one too on the next retry —
  // `-h` archives symlinks *outside* `node_modules` (this package's own
  // `.bin` entries, if any) as the files they point to, not as dead links
  // once separated from the source tree. `maxBuffer` raised on both ends:
  // the default 1 MiB (verified here, silently — spawnSync's own overflow
  // sets `res.error`, not a nonzero status with stderr text) truncates a
  // source package's own tarball (many packages' `lib/` + `src/` exceed it).
  const res = spawnSync('tar', ['--exclude=node_modules', '-chf', '-', '-C', srcDir, '.'], {
    encoding: 'buffer',
    maxBuffer: TAR_MAX_BUFFER,
  })
  if (res.error || res.status !== 0) {
    console.error(`pnpm-deploy: tar (create) for ${srcDir} failed: ${res.error?.message ?? res.stderr}`)
    return false
  }
  const extract = spawnSync('tar', ['-xf', '-', '-C', dest], { input: res.stdout, maxBuffer: TAR_MAX_BUFFER })
  if (extract.error || extract.status !== 0) {
    console.error(`pnpm-deploy: tar (extract) into ${dest} failed: ${extract.error?.message ?? extract.stderr}`)
    return false
  }
  return true
}

async function main() {
  runDeploy()
  const attempted = new Set()
  for (let round = 0; round < 20; round++) {
    const probe = await bootProbe()
    if (probe.ok) {
      console.log('pnpm-deploy: boot probe passed (no missing-module crash)')
      return
    }
    console.log(`pnpm-deploy: boot probe round ${round + 1}: ${probe.missing.size} missing module(s)`)
    let progressed = false
    for (const [missing, importedFrom] of probe.missing) {
      if (attempted.has(missing)) continue // already tried this exact package in an earlier round
      attempted.add(missing)
      console.log(`pnpm-deploy: missing module: ${missing} (imported from ${importedFrom})`)
      if (backfill(missing, importedFrom)) progressed = true
      else console.error(`pnpm-deploy: could not backfill "${missing}" — the deployed directory may still boot without it`)
    }
    if (!progressed) {
      console.error('pnpm-deploy: no new module could be backfilled this round — giving up')
      process.exit(1)
    }
  }
  console.error('pnpm-deploy: too many boot-probe rounds — giving up')
  process.exit(1)
}

await main()
