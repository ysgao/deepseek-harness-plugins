# dsh-plugins-headless-anthropic-login

**Status: Phase 0 scaffold — not yet implemented.**

The `dsh` CLI login command for Anthropic subscription authorization,
shipped as an installable `cordis.patch.yml` insert for the `headless`
profile:

```sh
dsh plugin --profile headless add dsh-plugins-headless-anthropic-login
```

Replaces the fork's direct edits to
`packages/bundle/headless/src/{index,startup}.ts` — the same command
behavior, delivered as an out-of-tree bundle layer instead of hand-edited
CLI source, per `packages/bundle/README.md`'s documented pattern:
*"out-of-tree bundles install into a profile through `dsh plugin
--profile <name> add <package>`."*
