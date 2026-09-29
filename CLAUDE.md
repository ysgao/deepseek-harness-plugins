# Working in this repo

Read CONSTITUTION.md before changing anything; it is short and it is the
authority. ARCHITECTURE.md explains the layout. This file exists only to put
the one rule that is easiest to break by accident in front of you first.

## Never modify `packages/_vendor/deepseek-harness`

That directory is a git submodule pinned to an upstream commit. It is not this
repo's code, and CONSTITUTION.md Article II forbids editing it — including
"just a one-line fix", and including edits that would make something here
build or typecheck.

When upstream lacks the seam you need, the answer is Article III: disable the
vendor plugin row that owns that surface and insert a replacement plugin in
this repo's own packages. A replacement must be a superset of the row it
disables — read Article III before writing one, because a replacement that
registers less than it replaced silently removes working features.

Three things enforce this, so a slip fails loudly rather than landing:

- `.claude/settings.json` denies `Edit`/`Write` under `packages/_vendor/**`.
- `pnpm run check:vendor` asserts the vendor tree is clean and the submodule
  pin still matches `vendorPin` in `scripts/replacement-parity.json`.
- A `pre-commit` hook runs that check. It is wired by `postinstall`; if hooks
  were already configured in your clone, the installer says so and stands down.

A pin bump is the one legitimate way the vendor changes, and it is not finished
when the submodule moves — the parity file and every fork hash move with it, in
the same commit. CONSTITUTION.md spells out that procedure.

## Commit to a branch, not `main` — docs are the one exception

CONSTITUTION.md Article VI: `main` only ever holds a state that has actually
been built and booted. Start real work on a branch (`git checkout -b
feat/<slug>`), build and boot-test it, merge locally once it works — never
commit code straight onto `main`, even "just this once."

The exception is narrow and mechanical, not a judgment call: a commit whose
every changed path is documentation (`.md`/`.txt`, a licence file — see
`DOC_ONLY_PATTERNS` in `scripts/check-main-branch-discipline.mjs`) may go
straight to `main`, because it cannot affect what gets built. One non-doc
path anywhere in the commit forfeits the exception for the whole thing.

*Enforced by:* the same `pre-commit` hook as the vendor check, via
`pnpm run check:main-discipline`. It rejects a commit on `main` that isn't
doc-only and prints the branch command to run instead — so this rule holds
even on a run that skipped reading this file first.

## Build

`pnpm install`, then `pnpm run build:vendor` (builds the submodule), then
`pnpm run build` (this repo's bundles — note it also installs them into your
`~/.dsh` profile unless `CI` is set). README.md has the details and the usual
failure modes.
