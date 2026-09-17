# `packages/mcp-connector/` — MCP connectors with OAuth 2.0

Connect Model Context Protocol servers to `dsh` — including remote ones that
authenticate with OAuth 2.0 and expire their access tokens hourly, which the
harness has no way to reach today.

## What the vendored harness does and does not do

`@deepseek-ai/dsh-mcp-client` at vendor pin `0d1f5000` supports exactly two
authentication shapes:

- a spawned stdio child process, with env vars; and
- a Streamable HTTP URL, with a **static** `headers` dictionary.

Its transport factory
([`packages/mcp/mcp-client/src/transport.ts`](../_vendor/deepseek-harness/packages/mcp/mcp-client/src/transport.ts))
builds its `StreamableHTTPClientTransport` with `{ requestInit: { headers:
config.headers } }` and passes **no** `authProvider`. There is no
authorization-code flow and no token refresh anywhere in the package. That is
a statement about the current release, not about a stale checkout.

A static header cannot carry a bearer token that expires every hour. Google's
official MCP servers do exactly that — confirmed live against the endpoints
themselves:

```console
$ curl -s https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1
{"authorization_servers":["https://accounts.google.com/"],"bearer_methods_supported":["header"],
 "resource":"https://gmailmcp.googleapis.com/mcp/v1","scopes_supported":["https://mail.google.com/", …]}
```

Drive publishes the same shape at
`https://drivemcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1`.
Both name `https://accounts.google.com/` as their authorization server, and
that authorization server publishes **no** `registration_endpoint` — so RFC
7591 Dynamic Client Registration is not available and an OAuth client
registered by hand in a Google Cloud project is mandatory. Its
`token_endpoint_auth_methods_supported` is `client_secret_post` /
`client_secret_basic`, so a client secret is required too, including for the
"Desktop app" client type.

## What this bundle adds

| Package | Role |
|---|---|
| [`mcp-client-oauth`](mcp-client-oauth/README.md) | A **superset** of `dsh-mcp-client`: the same two transports with the same config fields, defaults, reconnect policy, `serverName` reservation, instruction/resource publication, and model-facing tool names — plus a third `streamable-http-oauth` transport that hands the MCP SDK an `OAuthClientProvider` |
| [`connector-registry`](connector-registry/README.md) | The durable `mcp-connector` settings section and a live mount reconciler; publishes `ctx.mcpConnectors` |
| [`api-mcp-connector-controller`](api-mcp-connector-controller/README.md) | Typert Host controller: the `mcpConnectors` Remote namespace, with its own notice/prompt stream |
| [`client-remotes-mcp-connector`](client-remotes-mcp-connector/README.md) | Mounts that namespace's generated Client contribution |
| [`client-ui-settings-mcp-connector`](client-ui-settings-mcp-connector/README.md) | Settings > MCP connectors — an **additive** `settings.section` registration |
| [`cli-mcp-connector`](cli-mcp-connector/README.md) | `dsh --profile mcp add\|list\|set\|login\|logout\|remove\|status`, every command `--json` |
| [`bundle-mcp-connector`](bundle-mcp-connector/README.md) | The installable `cordis.patch.yml` layer |

Nothing here disables a vendor row for its own UI: `settings.section` is a
pristine `kind: 'list'` slot that `@deepseek-ai/dsh-client-ui-settings`
declares for a feature owning its own settings page, so unlike this repo's
`ui-workspace` / `ui-conversation` / `ui-settings-models` replacements, this
bundle carries **no replacement-parity obligation**.

## Install

```sh
./dsh plugin --profile web add "$(pwd)/packages/mcp-connector/bundle-mcp-connector"
./dsh --profile web
```

Install it **after** any other bundle in this repo that inserts the
`authorization-seam` row (`bundle-anthropic-subscription`, `cli-login-app`).
This bundle's patch disables that row id and re-inserts it, so exactly one
`@deepseek-ai/dsh-authorization` mount survives either way — but
`cordis.patch.yml` layers apply in the profile's own bundle-list order, so the
disable only finds an earlier layer's row, never a later one. A duplicate
mount of one service name is a hard Cordis conflict; a disable matching
nothing is a logged no-op.

For the CLI, its own profile:

```sh
./dsh plugin --profile mcp add "$(pwd)/packages/mcp-connector/cli-mcp-connector"
./dsh --profile mcp --help
```

## `dsh-mcp-client` is not disabled, and should not be

`@deepseek-ai/dsh-mcp-client` is not a bundle row this bundle replaces — it is
a plugin a profile instantiates **once per MCP server**, and a profile's own
`cordis.patch.yml` may well have several such rows already. Disabling it would
take those servers down. This bundle is purely additive and the two coexist.

Because the config field names, defaults, and derived tool names are identical,
migrating one server across is a one-word edit — change that row's `name:` from
`@deepseek-ai/dsh-mcp-client` to `dsh-plugins-mcp-client-oauth` — or re-add it
as a connector through the CLI or the Settings page. The one thing to avoid is
the *same* `serverName` live on both plugins at once: each keeps its own
namespace reservation, so the duplicate is not caught by that guard, only later
by `ctx.tools.register`, which refuses the duplicate public name and rolls that
server's whole tool generation back with a logged error.

## Where the credentials live, and where they don't

Two halves, deliberately kept apart:

- The **definition** — id, label, transport, URL or command, headers, scopes —
  is ordinary configuration and lives in the settings seam
  (`$DSH_HOME/settings.yaml`, section `mcp-connector`), where a configuration
  UI can read and write it and a human can hand-edit it. Nothing in it is a
  secret, so the document stays safe to read, print, diff, and copy between
  machines.
- The **credentials** — the OAuth client id and secret, the access token, and
  the refresh token — never touch that document. They live in the credential
  seam's record space under `mcp-connector/<id>`, and every write goes through
  `ctx.credentials.modifyRecord`, whose exclusion holds across processes where
  the backing store supports it. That is what makes a refresh-token rotation
  safe when a CLI run and the GUI both notice the access token expiring at the
  same moment.

## Setting up a Google connector

[`docs/google-workspace.md`](docs/google-workspace.md) is the full procedure
for Gmail, Drive, and Calendar: which Cloud APIs to enable (the product API
*and* the `*mcp.googleapis.com` service — enabling only the first is the usual
cause of a `PERMISSION_DENIED` after a clean sign-in), the consent-screen scope
list, the OAuth client, and the `set`/`login` calls. In short:

```sh
./dsh --profile mcp add gmail --url https://gmailmcp.googleapis.com/mcp/v1 \
    --client-id <id>.apps.googleusercontent.com --client-secret <secret>
./dsh --profile mcp login gmail
```

or, in the GUI, Settings → MCP connectors → Add connector, then **Sign in**.

Google issues no OAuth client automatically and `accounts.google.com` publishes
no `registration_endpoint`, so a client created by hand in a Google Cloud
project is mandatory, with `http://127.0.0.1:33418/mcp-oauth/callback`
registered byte for byte — RFC 6749 §3.1.2.3 has the authorization server
compare `redirect_uri` exactly.

The scopes come from the server's own RFC 9728 metadata, so `--scope` is
optional — pass it to request less than everything the server publishes, which
for Gmail includes full-mailbox `https://mail.google.com/`.

## Verified

Against the real endpoints, through the CLI, with no client credentials
configured (tool discovery on both servers is unauthenticated; only tool
*calls* need a token):

```console
$ dsh --profile mcp add gmail --url https://gmailmcp.googleapis.com/mcp/v1 --json
{"ok": true, "connector": {"health": "connected",
 "tools": ["mcp__gmail__create_draft", "mcp__gmail__list_drafts", … 23 tools],
 "oauth": {"authorized": false, "renewable": false, "clientConfigured": false},
 "authorizationKey": "mcp-connector/gmail"}}

$ dsh --profile mcp add drive --url https://drivemcp.googleapis.com/mcp/v1 --json
… "health": "connected", 8 tools, "authorizationKey": "mcp-connector/drive"
```

Completing a sign-in needs a Google OAuth client that only the account owner
can create, so the authorization-code leg is exercised by whoever holds that
client, not by this repo's checks.
