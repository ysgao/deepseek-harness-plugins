# dsh-plugins-client-remotes-mcp-connector

Mounts this bundle's own generated Remote contribution on the Client — the
`mcpConnectors` namespace. Without it, `ctx.remote.mcpConnectors` is never
populated in the browser even though the Host controller boots correctly:
`dsh-typert-loader` auto-discovers only a package's Host `./typert` half, and
the Client `./remote` half needs an explicit composition owner.

Its own dedicated plugin, doing nothing else, for the reason
`dsh-plugins-client-remotes-workspace-git` and
`dsh-plugins-client-remotes-anthropic-subscription` both document: a plugin
that mounts a `remote.<namespace>` contribution can never also be the plugin
that renders UI, because a `$mount` failure would throw that plugin's whole
`apply()` and take everything it renders down with it.

And the mount failure is **caught, not thrown** — this repo's Client loader
treats any top-level entry's `apply()` throwing as fatal to the entire boot, a
blank "Failed to load plugins" page for every feature in the app. That was
confirmed here rather than assumed: deliberately rethrowing the `$mount`
failure while diagnosing a namespace-method collision produced exactly that
blank page, and restoring the catch left the rest of the app working with only
the MCP connectors settings page absent.

`inject` is `['remote']` only — never `remote.mcpConnectors`, the key this
plugin itself provides: Cordis will not call a plugin's `apply()` until its
declared `inject` is satisfied, so the plugin that mounts a namespace can never
also inject it.
