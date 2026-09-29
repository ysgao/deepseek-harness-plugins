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
three ways of being "unmodified": that
`git -C packages/_vendor/deepseek-harness status --porcelain` is empty; that
the submodule commit this repo's index would record still equals `vendorPin`
in `scripts/replacement-parity.json` — a commit made *inside* the submodule
moves the pin while dirtying nothing the first check would see; and that the
submodule's own on-disk `HEAD` equals `vendorPin` too, not merely the index —
see Article VII for the failure that check closes.

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
  committing to `main` directly — except the narrow, mechanically-decidable
  exception below.
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

### Docs-only changes are exempt

The reasoning above is entirely about what a commit can do to the *build*: a
change committed straight to `main` is dangerous exactly to the extent that
it might be broken and yet stands between the next session and a working
`dsh`. A commit whose every changed path is documentation — prose, nothing
`pnpm run build` reads — cannot do that, by construction. There is nothing
for a branch or a boot-test checkpoint to protect against in that case, so
that commit may go straight to `main`.

The exact boundary of "documentation" is defined in exactly one place —
`DOC_ONLY_PATTERNS` in `scripts/check-main-branch-discipline.mjs` — and not
restated here, so the rule this article states and the rule the hook
enforces cannot quietly drift apart the way the same fact written twice
always eventually does. As adopted, that boundary is `.md`/`.txt` files and
licence files; nothing under `packages/**`, `scripts/**`, or any build or
tool config matches it. Widening it is a change to what this article
permits onto `main` unreviewed, and gets the same scrutiny as any other
amendment to this file.

One non-doc path is enough to disqualify the whole commit, even one mixed
into an otherwise all-docs change — there is no partial exemption.

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

*Enforced by:* two things, for the two different failure shapes this
article names.

Whether a commit reaches `main` *at all* while carrying anything beyond
documentation is decidable from the staged diff alone, with no need to
trust anyone's memory of having read this file — so it is mechanically
gated: `pnpm run check:main-discipline`
(`scripts/check-main-branch-discipline.mjs`), run automatically by the same
`pre-commit` hook as Article II's check. It is a no-op on any branch other
than `main`; on `main`, it refuses a commit whose staged paths are not all
doc-only and prints the branch-creation command to fix it. This is the gate
that used to not exist — the reason a change could be typed straight onto
`main`, only to be shifted onto a branch afterward once someone noticed —
and it is why that shifting is no longer a step anyone has to remember to
take.

Whether a *branch* actually got built and boot-tested before its merge is a
different question — no hook can verify a human ran a checkpoint rather
than skipped it — so that half is still enforced by discipline and by the
plain fact that a broken `main` is immediately felt in the next session's
own `dsh`, not by an automated gate.

Separately, the observable state of `origin` still carries exactly one
branch, `main`. A working branch pushed to `origin`, or a pull request open
against this repo, is itself the violation rather than evidence of one; the
remedy is to merge the work locally and delete the branch.

## VII. A build trusts only a checkout it can prove matches the pin

`vendorPin` in `scripts/replacement-parity.json` records the commit the
vendor *should* be at. Nothing about recording that guarantees the vendor
*is* at it: `git checkout` and `git submodule update` only ever touch tracked
files. A submodule pin can move in the index — the ordinary, legitimate way,
per Article IV — while the working tree that will actually be built still
sits on the commit before, because the checkout step never ran on this
machine or in this clone. Worse, a pin bump that deletes a package upstream
leaves its directory behind here too, kept alive by nothing but its own
`.gitignore`d contents (`node_modules/`, `lib/`) — invisible to `git status`,
invisible to the pin check, and still exactly where the vendor's own build
tooling will go looking for it.

None of this is Article II. The tracked tree is untouched in every one of
these states; `check:vendor` reports pristine. It is a different failure: a
build run against a checkout that only *claims* to be the pin. Its symptom is
a `tsc`/`tsdown` error shaped like a defect in the vendored code — a missing
export, an unresolvable entry, a module nothing in this pin depends on — on
whichever machine's local state happens to have drifted, while a machine
whose stale files happen to still match the target sails through and gives
no warning that the next pin bump, or the next clone, will not be so lucky.

So a build gets no benefit of the doubt about the checkout under it. Before
`pnpm run build:vendor` spawns anything, it proves, and refuses with the
exact fix command the moment one does not hold:

- the submodule's checked-out `HEAD` — not merely the index gitlink — equals
  `vendorPin`;
- the vendor's installed dependencies are not older than its own manifest and
  lockfile;
- no directory a vendor workspace glob matches is missing the `package.json`
  every real member has, and no `lib/` inside one is older than this
  checkout — both the signature of `.gitignore`d debris a pin bump left
  behind rather than genuine build output.

*Enforced by:* the preflight in `scripts/build-vendor.mjs`
(`assertBuildEnvironment`), which runs before every `pnpm run build:vendor`
and exits before any `pnpm` subprocess starts when one of the three does not
hold. The first — the checkout — is also part of `pnpm run check:vendor`
itself (`scripts/check-vendor-pristine.mjs`), so a stale checkout fails the
`pre-commit` hook too, not just a build.

---

## Amending this document

These articles are amendable, in the open, by changing this file in a commit
that says what changed and why. They are not amendable by exception: "just
this once" against any article above is the case the article exists for.
Anything that reads as a rule but is really a design decision belongs in
`ARCHITECTURE.md` instead — this file stays short enough to be read in full
before every non-trivial change.

*Adopted 2026-09-17, against vendor pin `0d1f5000`.*
