/**
 * Scopes the root test run to this repository's own packages.
 *
 * Without a config here, a bare `vitest run` walks the whole tree and also
 * collects the vendored harness's ~1900 spec files. Those are upstream's
 * tests and they cannot pass under this root, because they are written
 * against `packages/_vendor/deepseek-harness/vitest.config.ts`, which
 * supplies three things a bare run has no way to know about:
 *
 *   * `vite-tsconfig-paths` over the vendored `tsconfig.base.json`, so every
 *     `@deepseek-ai/dsh-*` import resolves to that package's `src/` instead
 *     of its built `lib/` export map. Vendor's own comment on that plugin
 *     spells out why it must win over package exports — otherwise a built
 *     `lib/` loads a second copy of a module singleton. Without it the run
 *     fails with "Failed to resolve entry for package".
 *   * two `setupFiles` (`scripts/test-proxy-environment.ts` and
 *     `scripts/test-invariants.ts`) that install the environment its suites
 *     assert against.
 *   * `pool: 'forks'`; the default pool's module runner rejects the
 *     `import.meta.resolve` those suites rely on.
 *
 * The specs under the vendored `scripts/` fail for a fourth, separate reason:
 * they import the vendored repo ROOT's own devDependencies, and that root is
 * deliberately not a workspace project in `pnpm-workspace.yaml` (only its
 * sub-projects are), so those 38 packages are never installed here.
 *
 * None of this indicates a problem with the vendored fork. Its tracked tree
 * matches the pinned upstream commit exactly, and upstream runs the same
 * suite green from its own root with its own config. The vendored harness
 * owns its test entrypoint and its own CI, so the correct fix is to stop
 * re-running it under a foreign config — never to edit vendor to suit this
 * root. To run it the way upstream does, use its own entrypoint:
 *
 *   pnpm --dir packages/_vendor/deepseek-harness run test
 *
 * (that also needs vendor's root devDependencies installed, which this
 * workspace intentionally does not do.)
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // This repo's own plugin bundles, mirroring pnpm-workspace.yaml's own
    // list of them. Vendored paths are excluded below rather than merely
    // omitted here, so a future broad glob can't silently re-collect them.
    include: [
      'packages/workspace-git/**/*.{test,spec}.{ts,tsx}',
      'packages/anthropic-subscription/**/*.{test,spec}.{ts,tsx}',
      'packages/terminal/**/*.{test,spec}.{ts,tsx}',
      'packages/mcp-connector/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      // The vendored harness in full: its own suite, and any session residue
      // (a stray `.claude/worktrees/<name>` checkout duplicates every spec in
      // the tree, which is how one abandoned worktree once doubled this sweep).
      'packages/_vendor/**',
    ],
    // This repo's packages ship no tests of their own yet. `vitest run` treats
    // an empty selection as an error, so without this the scoped command would
    // trade 943 vendored failures for a different non-zero exit. Keeping it
    // green here means `pnpm test` is already wired as a gate for the first
    // spec this repo adds.
    passWithNoTests: true,
  },
})
