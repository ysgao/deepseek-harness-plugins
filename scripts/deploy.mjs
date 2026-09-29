#!/usr/bin/env node
/**
 * Deploy a self-contained copy of this app to a *separate* directory, so a
 * running "production" instance is never affected by in-progress edits made
 * in this development checkout.
 *
 * This script never writes into the checkout it runs from. Every git/pnpm/
 * dsh operation below targets <target-dir> — a different clone of this same
 * repo (its own submodule checkout, its own node_modules, its own installed
 * profile) — never this checkout, and never this machine's real `~/.dsh`
 * (the target gets its own DSH_HOME under <target-dir>/.dsh-home unless
 * DEPLOY_DSH_HOME says otherwise). CONSTITUTION.md Article VI already
 * guarantees `main` only ever holds a state proven to build and boot, which
 * is exactly what makes it safe for <target-dir> to track `main` unattended.
 *
 * Usage (run with `node scripts/deploy.mjs ...` from this repo's root, or as
 * `node ./scripts/deploy.mjs ...`; <target-dir> may be relative or absolute
 * and is resolved against your current directory, not this repo's):
 *
 *   node scripts/deploy.mjs deploy  <target-dir> [--ref main] [--profile web] [--no-restart]
 *   node scripts/deploy.mjs update  <target-dir> [--ref main]        # fetch + rebuild only
 *   node scripts/deploy.mjs start   <target-dir> [--profile web]
 *   node scripts/deploy.mjs stop    <target-dir>
 *   node scripts/deploy.mjs restart <target-dir> [--profile web]
 *   node scripts/deploy.mjs status  <target-dir>
 *
 * `deploy` = clone-or-fetch <ref> into <target-dir>, rebuild the vendor
 * submodule and this repo's plugin bundles there, install them into that
 * target's own profile, then restart the running instance (unless
 * --no-restart). Safe to re-run any time — including from cron/CI — to roll
 * a newly-merged `main` commit out to the deployment.
 *
 * This script itself lives at scripts/deploy.mjs in every clone (dev and
 * deployed alike), so it also works run *from inside* the deployed copy to
 * update itself in place: `node scripts/deploy.mjs update .`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const THIS_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  console.error(`Usage: node scripts/deploy.mjs <deploy|update|build|start|stop|restart|status> <target-dir> [--ref <git-ref>] [--profile <name>] [--no-restart]`)
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) {
    console.error(`deploy: failed to run \`${cmd} ${args.join(' ')}\`: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) {
    console.error(`deploy: \`${cmd} ${args.join(' ')}\` exited ${res.status ?? `signal ${res.signal}`}`)
    process.exit(res.status ?? 1)
  }
  return res
}

function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return res.status === 0 ? res.stdout.trim() : ''
}

// ---- argv parsing -----------------------------------------------------

const argv = process.argv.slice(2)
const command = argv[0]
const targetArg = argv[1]
const rest = argv.slice(2)

function flag(name, fallback) {
  const i = rest.indexOf(name)
  if (i === -1) return fallback
  return rest[i + 1]
}
const hasFlag = (name) => rest.includes(name)

if (!command || !targetArg || argv.includes('--help') || argv.includes('-h')) {
  usage()
  process.exit(command ? 0 : 1)
}

const target = resolve(process.cwd(), targetArg)
const ref = flag('--ref', 'main')
const profile = flag('--profile', 'web')
const restartAfterDeploy = !hasFlag('--no-restart')
const dshHome = process.env.DEPLOY_DSH_HOME
  ? resolve(process.cwd(), process.env.DEPLOY_DSH_HOME)
  : join(target, '.dsh-home')
const deployMetaDir = join(target, '.deploy')
const pidFile = join(deployMetaDir, 'dsh.pid')
const logFile = join(deployMetaDir, 'dsh.log')

// Never let this script's operations bleed back into THIS_REPO.
if (resolve(target) === resolve(THIS_REPO)) {
  console.error(
    `deploy: refusing to target this repo's own checkout (${THIS_REPO}).\n` +
      'This script deploys to a *separate* clone — pass a different directory.',
  )
  process.exit(1)
}

function originUrl() {
  const url = capture('git', ['-C', THIS_REPO, 'config', '--get', 'remote.origin.url'])
  if (!url) {
    console.error(`deploy: could not read \`git remote origin\` from ${THIS_REPO}`)
    process.exit(1)
  }
  return url
}

function childEnv() {
  const env = { ...process.env, DSH_HOME: dshHome }
  delete env.CI // install-plugins.mjs no-ops under CI; a deploy must actually install.
  return env
}

// ---- git: clone-or-fetch, then land on <ref> ---------------------------

function ensureClone() {
  if (existsSync(join(target, '.git'))) return
  mkdirSync(dirname(target), { recursive: true })
  console.log(`deploy: cloning ${originUrl()} into ${target}`)
  run('git', ['clone', '--recurse-submodules', originUrl(), target])
}

function checkoutRef() {
  run('git', ['-C', target, 'fetch', 'origin', '--tags', '--prune'])
  const isBranch =
    spawnSync('git', ['-C', target, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${ref}`]).status === 0
  if (isBranch) {
    console.log(`deploy: checking out origin/${ref} (branch)`)
    run('git', ['-C', target, 'checkout', '-B', ref, `origin/${ref}`])
  } else {
    console.log(`deploy: checking out ${ref} (tag or commit)`)
    run('git', ['-C', target, 'checkout', ref])
  }
  run('git', ['-C', target, 'submodule', 'sync', '--recursive'])
  run('git', ['-C', target, 'submodule', 'update', '--init', '--recursive'])
}

// ---- build --------------------------------------------------------------

function buildTarget() {
  const env = childEnv()
  mkdirSync(dshHome, { recursive: true })
  console.log(`deploy: pnpm install (${target})`)
  run('pnpm', ['install'], { cwd: target, env })
  // The vendor submodule carries its own *separate* pnpm workspace/lockfile
  // (see scripts/build-vendor.mjs's own header comment) — its root package
  // is not itself a member the top-level `pnpm install` above touches, so a
  // genuinely fresh clone's `packages/_vendor/deepseek-harness/node_modules`
  // does not exist yet and build:vendor's own preflight refuses to proceed.
  // CI=true is the same early-exit the wrapper script uses for the same
  // directory, for the same reason: the vendor's postinstall lefthook
  // installer aborts on a submodule checkout otherwise.
  console.log('deploy: pnpm --dir packages/_vendor/deepseek-harness install (vendor\'s own nested workspace)')
  run('pnpm', ['--dir', 'packages/_vendor/deepseek-harness', 'install', '--frozen-lockfile'], {
    cwd: target,
    env: { ...env, CI: 'true' },
  })
  console.log('deploy: pnpm run build:vendor')
  run('pnpm', ['run', 'build:vendor'], { cwd: target, env })
  // Compile host + client libs directly (skip the `build` meta-script's own
  // trailing `install:plugins` call, which always defaults to the "web"
  // profile with no way to redirect it) so exactly one profile — the one
  // this deploy was asked for — ever gets installed into, never an
  // unrequested extra "web" profile alongside it.
  console.log('deploy: pnpm run build:lib:host')
  run('pnpm', ['run', 'build:lib:host'], { cwd: target, env })
  console.log('deploy: pnpm run build:lib:client')
  run('pnpm', ['run', 'build:lib:client'], { cwd: target, env })
  console.log(`deploy: installing bundles into profile "${profile}"`)
  run('node', ['scripts/install-plugins.mjs', '--profile', profile], { cwd: target, env })
}

// ---- process control ------------------------------------------------------

function readPid() {
  if (!existsSync(pidFile)) return null
  const n = Number(readFileSync(pidFile, 'utf8').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function startApp() {
  const bin = join(target, 'dsh')
  if (!existsSync(bin)) {
    console.error(`deploy: ${bin} not found — run \`deploy\`/\`build\` first`)
    process.exit(1)
  }
  const existing = readPid()
  if (existing !== null && isAlive(existing)) {
    console.log(`deploy: already running (pid ${existing})`)
    return
  }
  mkdirSync(deployMetaDir, { recursive: true })
  const logFd = openSync(logFile, 'a')
  const child = spawn(bin, ['--profile', profile], {
    cwd: target,
    env: childEnv(),
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  child.unref()
  writeFileSync(pidFile, String(child.pid))
  console.log(`deploy: started \`./dsh --profile ${profile}\` (pid ${child.pid})`)
  console.log(`deploy: DSH_HOME=${dshHome}`)
  console.log(`deploy: logs at ${logFile}`)
}

function stopApp() {
  const pid = readPid()
  if (pid === null || !isAlive(pid)) {
    console.log('deploy: not running')
    if (existsSync(pidFile)) rmSync(pidFile)
    return
  }
  console.log(`deploy: stopping (pid ${pid})`)
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 10 && isAlive(pid); i++) spawnSync('sleep', ['1'])
  if (isAlive(pid)) {
    console.log('deploy: still alive after 10s — sending SIGKILL')
    process.kill(pid, 'SIGKILL')
  }
  if (existsSync(pidFile)) rmSync(pidFile)
}

function statusApp() {
  const pid = readPid()
  if (pid !== null && isAlive(pid)) {
    console.log(`deploy: running (pid ${pid}) — profile=${profile}, DSH_HOME=${dshHome}, dir=${target}`)
  } else {
    console.log(`deploy: not running — dir=${target}`)
  }
}

// ---- dispatch -------------------------------------------------------------

switch (command) {
  case 'deploy': {
    ensureClone()
    checkoutRef()
    buildTarget()
    if (restartAfterDeploy) {
      stopApp()
      startApp()
    } else {
      console.log('deploy: --no-restart set — built but not (re)started')
    }
    break
  }
  case 'update': {
    ensureClone()
    checkoutRef()
    buildTarget()
    break
  }
  case 'build': {
    buildTarget()
    break
  }
  case 'start':
    startApp()
    break
  case 'stop':
    stopApp()
    break
  case 'restart':
    stopApp()
    startApp()
    break
  case 'status':
    statusApp()
    break
  default:
    usage()
    process.exit(1)
}
