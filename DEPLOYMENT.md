# Deploying to a separate location

Two independent ways to deploy live here. **`pnpm deploy` (below) is the
recommended one**: it needs no git clone, no rebuild, and no network —
everything is produced from what this checkout already has installed and
built, in seconds to a couple of minutes depending on what it must
backfill. The clone-based approach further down remains available for a
true separate-host, separate-git-history deployment.

## Pnpm-native deploy (`scripts/pnpm-deploy.mjs`) — no clone, no rebuild, no network

Three steps, each independently useful, each runnable entirely offline on
this same machine (tested on Linux; nothing about it is Linux-specific —
the same pnpm/Node commands apply under Termux or macOS):

### 1. Deploy the vendor engine

```sh
node scripts/pnpm-deploy.mjs @deepseek-ai/dsh /path/to/prod-engine
```

This uses pnpm's own builtin `pnpm deploy` (`--legacy --offline`, `--prod`
by default) to produce a **standalone, self-contained copy** of the vendor
CLI at `/path/to/prod-engine` — every dependency is a real file
(hard-linked from the local content-addressable store), not a symlink back
into this checkout. Since the vendor submodule is never edited (Article II),
this is byte-for-byte what deploying pristine `deepseek-ai/deepseek-harness`
directly would produce.

`pnpm deploy`'s own closure computation misses some packages — verified
here: dozens, all the same shape (a peer dependency satisfied in the source
workspace by a hoist local to one package's own `node_modules`, which
`--legacy` deploy doesn't replicate). The script closes every one of these
mechanically: it boots the deployed copy for real, and on every
"missing module" or "failed to import" it finds, copies that package's real
source directory in and retries — however many rounds that takes (verified:
up to 10, ~30 packages, cascading three levels deep). The result is
verified end to end here: a real listening server, `curl` gets a real HTTP
response, zero warnings.

### 2. Deploy each of this repo's own plugin bundles

```sh
node scripts/pnpm-deploy.mjs dsh-plugins-bundle-workspace-git          /path/to/bundle-workspace-git
node scripts/pnpm-deploy.mjs dsh-plugins-bundle-anthropic-subscription /path/to/bundle-anthropic-subscription
node scripts/pnpm-deploy.mjs dsh-plugins-bundle-mcp-connector          /path/to/bundle-mcp-connector
node scripts/pnpm-deploy.mjs dsh-plugin-terminal                       /path/to/plugin-terminal  # optional, see README.md
```

Same tool, same guarantee, applied to this repo's own bundle packages
instead of the vendor engine — each becomes its own standalone directory,
no dependency on this checkout remaining. Verified here: all four
(including the optional terminal plugin) deploy cleanly with no backfill
needed at all — they don't ship a `dsh` CLI, so there's nothing for the
boot-probe step to exercise on its own; step 3 is their real test.

### 3. Wire the bundles into a running `dsh` (optional, manual)

The deployed engine from step 1 and the deployed bundles from step 2 are
both plain directories now — nothing about them is specific to a particular
`$DSH_HOME`. Add them to any profile the normal way:

```sh
/path/to/prod-engine/dsh plugin --profile <name> add /path/to/bundle-workspace-git
/path/to/prod-engine/dsh plugin --profile <name> add /path/to/bundle-anthropic-subscription
/path/to/prod-engine/dsh plugin --profile <name> add /path/to/bundle-mcp-connector
/path/to/prod-engine/dsh --profile <name>
```

(there's no `./dsh` wrapper script inside a `pnpm deploy` output the way
there is in this checkout — invoke `<prod-engine>/lib/bin.js` directly with
`node`, or `<prod-engine>/node_modules/.bin/dsh` if `pnpm deploy` produced
one.) `$DSH_HOME` defaults to your own real `~/.dsh`, so this is a genuine
choice, not a limitation of the tool: point a **new** profile name at these
deployed directories to keep it fully separate from whatever profile your
day-to-day dev checkout's own `./dsh` already runs under the same
`~/.dsh` — or add them to that same existing profile if you specifically
want the two to converge. Either way, **this step touches shared,
possibly-live state** (a running `dsh` process reads its profile's
`node_modules` at boot, so `plugin add` against a profile something is
currently serving needs a restart to take effect, same as any other install
— see `README.md`'s "An install only reaches a running app on its next
boot"), so it deliberately isn't automated by this tool the way steps 1–2
are; do it by hand, or through Settings > Plugins in a running `dsh` Web UI.

### What this mechanically proves, and one caveat

Every claim above (self-contained, boots clean, real HTTP response, no
registry access) was verified by actually running it, not asserted — see
`scripts/pnpm-deploy.mjs`'s own header for the full account of what failed
first and why the final approach (`--legacy --offline` deploy + a
boot-probe-and-backfill loop) is what it is.

Step 3 itself was verified too, on a scratch `$DSH_HOME` (never the real
`~/.dsh` — see above for why that stays manual): a deployed engine had
`dsh-plugin-terminal` and `dsh-plugins-bundle-workspace-git` (deployed the
same way, standalone) each `plugin add`ed into a fresh profile and booted.
Both activated for real, not just "didn't crash": the terminal plugin logs
its own `[dsh-plugin-terminal] host half active` line, and
`--dump-config` on the workspace-git run shows vendor's `ui-workspace` row
correctly `disabled: true` ("patched by dsh-plugins-bundle-workspace-git")
with its replacement `workspace-enhanced` row present — genuine
row-replacement composition, not merely an absence of errors.

One residual, low-risk artifact: pnpm's own virtual store keeps one internal
self-referential symlink (`node_modules/.pnpm/node_modules/<deployed-pkg-
name>`) pointing back at this checkout for the deployed package itself.
Nothing that actually runs traverses it — the deployed package's real,
loaded content is the plain top-level files `pnpm deploy` already wrote
directly into the target directory — so it does not reintroduce the
dev-source coupling this tool exists to remove, but it is worth knowing it's
there if you ever audit a deployed directory for stray references to this
checkout's path.

## Clone-based deploy (`scripts/deploy.mjs`) — a separate host, separate git history

This checkout (wherever it lives — `.` if you're reading this in it) is a
**development** checkout: source, branches, in-progress edits, an
occasionally-broken `lib/`. Nothing about "the app" should ever run *out of*
it in a way that a mid-edit source tree can take down. CONSTITUTION.md
Article VI already gives the tool for this — `main` only ever holds a state
that has actually been built and booted — so deployment is just: **a second,
independent clone of this same repo, pinned to `main`, built and run from
its own directory, with its own profile.** Nothing here patches the vendor
or adds a second installation path (Article I/II still apply); this is only
"clone, build, install a profile" — the exact steps in `README.md`'s
"Getting started"/"Running" — run against a directory that is not this one,
repeatably.

`scripts/deploy.mjs` automates that. It never writes into the checkout it is
invoked from; every operation targets `<target-dir>`, a directory you choose
that is not this one.

## One-time setup

```sh
node scripts/deploy.mjs deploy /opt/dsh-app
```

This:

1. Clones this repo (`git clone --recurse-submodules`, following whatever
   `origin` *this* checkout is configured with) into `/opt/dsh-app`, or, if
   something is already cloned there, fetches and fast-forwards it — either
   way landing on `main` (override with `--ref <branch|tag|commit>`).
2. Runs `pnpm install`, `pnpm run build:vendor`, `pnpm run build` **inside
   `/opt/dsh-app`** — a completely separate `node_modules` and set of
   compiled `lib/` outputs from this checkout's.
3. Installs the three bundles into a profile named `web` (`--profile` to
   change it) that lives at `/opt/dsh-app/.dsh-home/profiles/web` — **not**
   this machine's real `~/.dsh`, and not this checkout. Every symlink that
   profile's `node_modules` holds resolves inside `/opt/dsh-app`, never back
   to this development checkout.
4. Starts `./dsh --profile web` inside `/opt/dsh-app`, detached, logging to
   `/opt/dsh-app/.deploy/dsh.log`, pid tracked in
   `/opt/dsh-app/.deploy/dsh.pid`.

From this point on, editing source here — even leaving it mid-refactor with
a broken build — has no effect on the running instance at `/opt/dsh-app`.
The two are separate git working trees, separate `node_modules`, separate
compiled output, separate profile.

## Rolling out a change

Once you've finished a feature on a branch here and merged it to `main` per
Article VI's checkpoint (built + boot-tested on the branch first), ship it:

```sh
node scripts/deploy.mjs deploy /opt/dsh-app
```

Re-running `deploy` is always safe: it fetches the latest `main`, rebuilds,
and only *then* restarts the running instance (stop, then start — a few
seconds of downtime, not a rolling/blue-green swap). Pass `--no-restart` to
fetch and rebuild without touching the running process (e.g. to pre-warm a
build during a maintenance window before flipping it over by hand with
`restart`).

You can also run this same command **from inside** the deployed copy itself
— `scripts/deploy.mjs` is part of the repo, so `/opt/dsh-app/scripts/
deploy.mjs` exists too:

```sh
cd /opt/dsh-app
node scripts/deploy.mjs update .   # fetch + rebuild only, no restart
node scripts/deploy.mjs restart .  # then flip over by hand
```

## Operating it

```sh
node scripts/deploy.mjs status  /opt/dsh-app
node scripts/deploy.mjs stop    /opt/dsh-app
node scripts/deploy.mjs start   /opt/dsh-app
node scripts/deploy.mjs restart /opt/dsh-app
```

For a real host you'd normally hand this off to `systemd`/`pm2`/your
process supervisor of choice instead of the pid-file tracking above — the
supervisor would run `./dsh --profile web` directly (with `DSH_HOME=/opt/
dsh-app/.dsh-home` in its environment) and call `node scripts/deploy.mjs
update <target>` as its pre-deploy hook, letting the supervisor own
start/stop/restart/crash-recovery instead.

## What this buys you, concretely

- **A broken edit here never reaches the deployment.** The deployment only
  ever moves when you explicitly run `deploy`/`update` against it, and that
  pulls `main` — which Article VI already promises is always a state that
  built and booted.
- **A build in progress here never corrupts a running app's files.** The
  deployment has its own `lib/`/bundle output on disk, produced by its own
  `pnpm run build` run in its own directory; this checkout's `tsc`/`tsdown`
  output is a different set of files entirely.
- **No shared `~/.dsh`.** The deployment's profile, credentials, and
  installed bundle list live under `<target-dir>/.dsh-home`, never under
  this machine's real `~/.dsh` (which your own day-to-day `./dsh --profile
  web` here still uses, untouched).

## A gap this script closes that `README.md`'s own steps don't

`README.md`'s "Getting started" says `pnpm install` then `pnpm run
build:vendor`. That works in *this* checkout because
`packages/_vendor/deepseek-harness/node_modules` already exists here from
past work — but the vendor submodule carries its own separate, nested pnpm
workspace and lockfile (its root package is not itself a member of this
repo's top-level `pnpm-workspace.yaml`), so a genuinely fresh clone's vendor
`node_modules` does not exist yet, and `build:vendor`'s own preflight
(`scripts/build-vendor.mjs`, CONSTITUTION.md Article VII) correctly refuses
to build against it rather than failing deep inside `tsc` later. `deploy.mjs`
runs `pnpm --dir packages/_vendor/deepseek-harness install --frozen-lockfile`
(with `CI=true`, same reasoning as `build-vendor.mjs`'s own wrapper) before
`build:vendor`, so a fresh clone succeeds unattended. Confirmed by actually
cloning into a scratch directory and watching it hit, and clear, exactly this.

## Limits worth knowing

- This is a single-host, single-instance deploy — one running `dsh`
  process, restarted in place. It is not a rolling/blue-green setup; a
  `restart` has a short gap where nothing is listening.
- `scripts/deploy.mjs restart`/`start` back the process with a plain
  detached child + pid file, not a supervisor: it will not come back on its
  own after a host reboot or an out-of-band crash. Wire it into `systemd`
  (or similar) for that, per "Operating it" above.
- `packages/terminal/dsh-plugin-terminal` is optional and intentionally
  never auto-installed by `pnpm run build`/`install:plugins` (see
  `README.md`); add it to the deployment by hand if you want the terminal
  panel there too:
  `/opt/dsh-app/dsh plugin --profile web add /opt/dsh-app/packages/terminal/dsh-plugin-terminal`.
