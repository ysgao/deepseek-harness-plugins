# dsh-plugins-bundle-anthropic-subscription

**Status: Phase 0 scaffold — not yet implemented.**

The installable `dsh --profile` patch layer for Anthropic subscription
authorization. Installed into a profile with:

```sh
dsh plugin --profile web add dsh-plugins-bundle-anthropic-subscription
```

`cordis.patch.yml` (not yet written) inserts the four
`packages/anthropic-subscription/*` packages as rows over the target
profile's existing `base`/`web-app`/`headless` composition — no edit to
`packages/bundle/{base,web-app,headless}` in the vendored harness. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
