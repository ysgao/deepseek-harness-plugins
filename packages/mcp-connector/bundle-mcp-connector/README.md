# dsh-plugins-bundle-mcp-connector

The installable `dsh --profile` patch layer for MCP connectors.

```sh
./dsh plugin --profile web add "$(pwd)/packages/mcp-connector/bundle-mcp-connector"
```

Install it **after** any other bundle in this repo that inserts the
`authorization-seam` row (`bundle-anthropic-subscription`, `cli-login-app`).
This bundle's patch disables that row id and re-inserts it, so exactly one
`@deepseek-ai/dsh-authorization` mount survives either way — but
`cordis.patch.yml` layers apply in the profile's own bundle-list order, so the
disable only reaches an earlier layer's row. A duplicate mount of one service
name is a hard Cordis conflict; a disable matching nothing is a logged no-op.

Verified composition in a `web`-derived profile that also carries
`bundle-anthropic-subscription`:

```yaml
# == dsh-plugins-bundle-anthropic-subscription, patched by dsh-plugins-bundle-mcp-connector
- id: authorization-seam
  name: '@deepseek-ai/dsh-authorization'
  disabled: true
…
# == dsh-plugins-bundle-mcp-connector
- id: authorization-seam
  name: '@deepseek-ai/dsh-authorization'
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
