# Constitution

The rules this repository does not trade away. Everything in
[`ARCHITECTURE.md`](ARCHITECTURE.md) is design — reasoned, revisable, and
argued from a specific problem. What follows is the short list that design
is not allowed to contradict, whatever the problem turns out to be.

Each article names how it is enforced. An article with no enforcement is a
wish, so every one here is either mechanically checked, or has a named
procedure that must be run and reported before the work counts as done.

---

## I. Everything is a plugin

Every feature — including one that replaces part of the shipped UI — is an
ordinary `dsh` plugin package, installed through `dsh plugin --profile
<name> add`/`remove`. There is no other installation path: no build-time
flag, no environment variable, no "just edit this file first" step.

*Enforced by:* review. A feature that cannot be expressed as a plugin
installation is out of scope for this repo (see ARCHITECTURE.md's
"Explicitly out of scope"), not a reason to add a second mechanism.

## II. The vendor submodule is read-only

`packages/_vendor/deepseek-harness/` is a pinned git submodule tracking
`deepseek-ai/deepseek-harness`, and its tracked tree must always be
byte-identical to the upstream commit it is pinned to. It is never patched,
forked, edited, or partially reverted — not to fix a bug, not to add a seam,
not temporarily, and not as a patch file kept on disk "for someday
proposing upstream". The only legitimate change to it is a pin bump.

An upstream-worthy change belongs in a real pull request against
`deepseek-ai/deepseek-harness`, filed from a personal fork. Everything else
belongs in this repo's own packages, using Article III.

*Enforced by:* `pnpm run check:vendor`
(`scripts/check-vendor-pristine.mjs`), run automatically by the `pre-commit`
hook in `.githooks/`, which `postinstall` wires into every clone. It asserts
both halves of "unmodified": that
`git -C packages/_vendor/deepseek-harness status --porcelain` is empty, and
that the submodule commit this repo's index would record still equals
`vendorPin` in `scripts/replacement-parity.json` — a commit made *inside* the
submodule moves the pin while dirtying nothing the first check would see.

Ahead of that, `.claude/settings.json` denies `Edit`/`Write` under
`packages/_vendor/**` for a session running under Claude Code specifically,
so that one tool refuses the edit rather than catching it after it's made.
That file's schema (`permissions.deny`, `sandbox.filesystem.denyWrite`) is
Claude Code's own settings format — no other agent tool reads it, and
neither this repo nor `dsh` itself defines a per-path write-deny primitive
an agent tool could read instead. The pre-commit hook above is what actually
holds regardless of which tool is editing; this second layer is a bonus for
the one tool it applies to, not a second guarantee.

Neither layer is the point. The rule is the point; they exist so that
breaking it fails loudly instead of landing quietly, and `--no-verify` still
belongs to whoever is willing to answer for it.

## III. A replacement never subtracts

Where the seam a feature needs does not exist upstream, the answer is to
disable the vendor plugin row that owns that surface and insert an enhanced
out-of-tree plugin in its place — never to patch the vendor (Article II).

**A `disabled: true` row takes every one of its own contributions down with
it.** So a replacement is not merely allowed to be a superset of the row it
replaces, it is *required* to be one. Anything the original registered,
provided, declared, or rendered and the replacement does not is not a
missing enhancement — it is a working feature that the user had before
installing this repo's bundle and does not have after.

Concretely, for the vendor row `V` that a replacement `R` disables:

- every slot `V` registers, `R` registers, under the same slot name, entry
  id, and ordering;
- every service `V` provides, `R` provides;
- every locale key `V` defines, `R` defines, in the same namespace;
- every config field `V` accepts, `R` accepts, with the same defaults, so a
  profile configured against `V` keeps working;
- every service `V` injects, `R` injects;
- every behaviour of a vendor file that `R` forks survives the fork.

A deliberate difference is permitted only when it is *recorded* — in
`scripts/replacement-parity.json`'s `divergences`, with the reason — so that
the next person to read the fork can tell an intended difference from an
omission. An unrecorded difference is a bug by definition, whether or not
anyone meant it.

*Enforced by:* `pnpm run check:parity`, plus the pin-bump procedure in
Article IV. The check is textual and cannot prove a forked component still
renders every branch; that is why it refuses to pass while a forked file's
vendor original has moved, which forces the human read.

## IV. A vendor pin bump is not finished when it builds

Upstream changing is the normal way Article III gets violated: a new slot, a
new locale key, a reshaped component, and the replacement quietly keeps
registering last release's surface. A green typecheck will not notice, because
the replacement is type-correct — it is just less than it replaced.

So a commit that moves the submodule pin is finished only when, in the same
change:

1. `pnpm run check:parity` passes, with every forked file re-read against
   its moved vendor original and its recorded hash updated by hand;
2. `scripts/replacement-parity.json`'s `vendorPin` is moved to the new
   commit in the same change, so `pnpm run check:vendor` passes. That check
   is what makes a half-done pin bump impossible to commit: bumping the
   submodule without touching the parity file fails it, which is exactly the
   state in which the fork hashes above still describe the *previous*
   release;
3. `pnpm run typecheck` and `pnpm run build` pass for the whole workspace;
4. every bundle still boots, and the replaced surfaces are exercised in the
   running app, not just compiled (ARCHITECTURE.md's "Testing procedures");
5. the pin bump and the plugin resync are reported together — a pin bump
   reported as done while the replacements still target the previous release
   misstates what was delivered.

*Enforced by:* the procedure in ARCHITECTURE.md's "Replacement parity", and
by reporting its results in the commit that bumps the pin.

## V. A plugin never takes down `dsh`

A plugin's absence is normal and must degrade, not fail. A plugin's failure
must fail loudly in its own log and stay inside its own fiber.

This repo's Client boot treats *any* top-level loader entry left inactive —
thrown or merely pending forever — as fatal for the whole application, not
for that one feature. Two consequences are binding: an operation that can
genuinely fail at runtime lives in its own dedicated plugin that catches and
logs rather than throwing, and an optional cross-plugin service is required
through a nested `ctx.inject()` inside an already-satisfied `apply()`, never
through a top-level `inject` array.

*Enforced by:* the fault-injection procedure in ARCHITECTURE.md ("Fault-inject
a plugin to prove `dsh` survives it"), run whenever a plugin's mount, inject,
or registration shape changes.

## VI. `main` is a running build, not a workspace

The `dsh` that develops this repo *is* a build of this repo — the profile
running this session's own GUI is composed from `main` as it stands right
now. That is a live dependency, not a metaphor: a change committed to `main`
mid-feature, before it builds and boots, can take down the very tool being
used to write the rest of the feature. So `main` only ever holds a state
that has actually been built and booted successfully; everything else
happens on a branch.

Concretely:

- **All development happens on a branch**, created from `main`, never by
  committing to `main` directly.
- **The branch is built and boot-tested at a checkpoint before it merges** —
  "Testing procedures" in ARCHITECTURE.md names what that means: `pnpm run
  build`, the disposable-profile boot, and (for a replacement package or a
  submodule pin) "Replacement parity". A commit that fails any of these is
  fixed on the branch, not merged past.
- **The branch does not merge to `main` until every feature it carries
  works.** A branch may sit unmerged for as long as it needs to; a partial
  or speculative state belongs on the branch, never on `main`, however long
  that takes.
- **The merge itself is local**, same as before: `git merge` (or `git
  worktree` for parallel work), never a pull request. This repository has
  one author, and a pull request against it has no reviewer but the person
  who wrote it — see the unchanged reasoning below.

This is what makes it safe to keep developing `dsh` and its plugins with the
very `dsh` build this repo produces: `main` is always the last state proven
to build and boot, so switching back to it (or starting a fresh session
against it) never hands you a broken tool.

### No pull request against this repo

A pull request here has no reviewer but the person who wrote it, so a change
still reaches `main` by commit — directly once proven on a branch, per
above, never by opening a PR. No pull request is opened against this repo,
and no working branch reaches `origin`.

This says nothing about upstream. Article II's instruction to send an
upstream-worthy change as a real pull request against
`deepseek-ai/deepseek-harness` stands unchanged: that one is filed from a
personal fork against a repository whose maintainers actually are the
reviewers. The rule here governs only this repo, where the review would be
self-addressed.

The rule is "never open one" rather than "close it afterwards" because the
mistake is not reversible: GitHub has no way to delete a pull request — not
in the web UI, not in the API or `gh` — and Support removes one only when it
leaks a credential. An accidental PR against this repo is a permanent entry
in its history.

*Enforced by:* the observable state of `origin`, which carries exactly one
branch, `main`. A working branch pushed to `origin`, or a pull request open
against this repo, is itself the violation rather than evidence of one; the
remedy is to merge the work locally and delete the branch. That `origin`
check cannot see whether a *local* commit landed on `main` before or after
its build/boot checkpoint — that half is enforced by discipline (this
article) and by the plain fact that a broken `main` is immediately felt in
the next session's own `dsh`, not by an automated gate.

---

## Amending this document

These articles are amendable, in the open, by changing this file in a commit
that says what changed and why. They are not amendable by exception: "just
this once" against any article above is the case the article exists for.
Anything that reads as a rule but is really a design decision belongs in
`ARCHITECTURE.md` instead — this file stays short enough to be read in full
before every non-trivial change.

*Adopted 2026-09-17, against vendor pin `0d1f5000`.*
