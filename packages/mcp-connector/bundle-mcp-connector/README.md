# dsh-plugins-bundle-mcp-connector

The installable `dsh --profile` patch layer for MCP connectors.

```sh
./dsh plugin --profile web add "$(pwd)/packages/mcp-connector/bundle-mcp-connector"
```

This bundle no longer carries an `authorization-seam` row. As of vendor pin
`477b4f42`, `@deepseek-ai/dsh-base` mounts `@deepseek-ai/dsh-authorization`
itself as its own `authorization` row, so the disable-then-reinsert pair this
bundle used to carry became a second mount of one service name — a hard Cordis
conflict that left the seam inactive and took OAuth sign-in down with it. The
seam is still required and still present; it is the base bundle's row now.

Verified composition in a `web`-derived profile that also carries
`bundle-anthropic-subscription`:

```yaml
# == @deepseek-ai/dsh-base
- id: authorization
  name: '@deepseek-ai/dsh-authorization'
…
# == dsh-plugins-bundle-mcp-connector
- id: mcp-connector
- id: mcp-connector-controller
- id: remotes-mcp-connector
- id: ui-settings-mcp-connector
```

Requires `@deepseek-ai/dsh-typert-loader`, part of every `dsh-base`-derived
profile (`web`, `headless`, `acp`, `sdk`) — install into one of those, not
`sdk-minimal`.

Nothing here disables a vendor row for its own UI: the Settings page registers
into the pristine `settings.section` list slot. In particular it does **not**
disable `@deepseek-ai/dsh-mcp-client`, which a profile instantiates once per
MCP server through its own rows — disabling it would take those servers down.
See the group [`README.md`](../README.md) for how to migrate one across.
