# dsh-plugins-bundle-workspace-git

**Status: Phase 0 scaffold — not yet implemented.**

The installable `dsh --profile` patch layer for the File manager + git
feature. Installed into a profile with:

```sh
dsh plugin --profile web add dsh-plugins-bundle-workspace-git
```

`cordis.patch.yml` (not yet written) inserts the five
`packages/workspace-git/*` packages as rows over the target profile's
existing `base`/`web-app` composition — no edit to
`packages/bundle/base` or `packages/bundle/web-app` in the vendored
harness. See [`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
