# dsh-plugins-bundle-anthropic-subscription

**Status: confirmed working.** Installed into a real (test) `$DSH_HOME` via
`dsh plugin --profile acp add dsh-plugins-bundle-anthropic-subscription`,
reconciled into `dsh.profile.bundles` automatically, and `dsh --profile acp`
boots to a clean exit with the `authorization` Typert namespace registered.

The installable `dsh --profile` patch layer that exposes `ctx.authorization`
as an RPC surface to a web/host client. Installed into a `dsh-base`-derived
profile (`web`, `headless`, `acp`, `sdk` — not `sdk-minimal`) with:

```sh
dsh plugin --profile web add dsh-plugins-bundle-anthropic-subscription
```

`cordis.patch.yml` inserts two rows: `@deepseek-ai/dsh-authorization`
itself (confirmed absent from every shipped bundle in a pristine
`deepseek-ai/deepseek-harness` checkout — `yga/deepseek-harness`'s fork
added that row to its own `base` bundle, which is why depending on it
being already-present would have quietly broken on real upstream) and
`dsh-plugins-api-authorization-controller`. No edit to
`packages/bundle/{base,web-app,headless}` in the vendored harness.
Anthropic subscription sign-in itself needs nothing new:
`@deepseek-ai/dsh-llm-pi-ai`, already part of `dsh-base`, registers a
dormant `ctx.authorization` flow per installed pi-ai catalog provider —
Anthropic included — the moment `ctx.authorization` exists; this bundle
only adds the seam plus the surface a client drives that flow through.

For CLI-only sign-in (no web client), use
[`dsh-plugins-cli-login-app`](../cli-login-app/README.md) instead — a
separate, dedicated profile, deliberately not composed into this bundle. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
