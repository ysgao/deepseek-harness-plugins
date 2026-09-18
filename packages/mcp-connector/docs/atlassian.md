# Connecting Atlassian — Jira and Confluence

Two routes, and they are genuinely different trades rather than one being a
worse version of the other.

| | Remote (`streamable-http-oauth`) | Local (`stdio`) |
|---|---|---|
| Server | Atlassian's `https://mcp.atlassian.com/v1/mcp` | `uvx mcp-atlassian`, a Python server built on FastMCP |
| Credential | OAuth grant, refreshed automatically | a Jira/Confluence API token |
| Client registration | RFC 7591, automatic | n/a |
| Runs | nothing locally | a Python child process per `dsh` |
| Tools | whatever Atlassian publishes | 98 at the time of writing |
| Needs | a browser, once | `uv` on PATH, and a token you rotate yourself |

The remote route is the better default: no local runtime, no long-lived
secret, and the token rotation problem disappears into the OAuth refresh. The
local route is worth keeping when its larger tool surface matters — page
diffs, attachment download, templates and permission tools have no counterpart
in the remote server's published set.

Whichever you choose, run only one of them under a given connector id. Two
mounts of one `serverName` are refused by `ctx.tools.register`, which rolls
that server's whole tool generation back with a logged error.

## Remote: Atlassian's own MCP server

```sh
./dsh --profile mcp add atlassian --label "Atlassian" \
    --url https://mcp.atlassian.com/v1/mcp
./dsh --profile mcp login atlassian
```

That is the whole configuration. There is no client id to create, because
`mcp.atlassian.com` is its own authorization server and publishes a
`registration_endpoint`:

```console
$ curl -s https://mcp.atlassian.com/.well-known/oauth-authorization-server | jq '{issuer, registration_endpoint}'
{"issuer": "https://mcp.atlassian.com",
 "registration_endpoint": "https://mcp.atlassian.com/v1/register"}
```

So the first sign-in registers a client itself and stores it in the credential
record, PKCE `S256`, alongside the tokens. Nothing to paste, no console, and
nothing for a second machine to copy but the grant.

Until that sign-in completes the connector reads `health: failed` with no
tools. That is not an error — an OAuth connector contributes nothing before it
is authorized, and unlike Google's servers this one answers an unauthenticated
request with `401`, so there is nothing to enumerate in the meantime.

Two facts about this server worth knowing, because both are departures from
the Google case:

- It publishes **no** RFC 9728 protected-resource document
  (`/.well-known/oauth-protected-resource` is a 404), so discovery falls back
  to the authorization-server metadata on its own origin. That fallback is
  also what surfaced the nested-`undefined` write bug described in
  `mcp-client-oauth`'s README — fixed, but the shape is worth recognising if a
  future server behaves the same way.
- It publishes no `scopes_supported`, so nothing is requested by default. If
  consent errors on scope, set them explicitly with `--scope`, including
  `offline_access` if a refresh token is wanted.

## Local: `mcp-atlassian` over stdio

Needs `uv` on PATH. The token is a Jira/Confluence API token from
<https://id.atlassian.com/manage-profile/security/api-tokens>; one token
serves both products.

```sh
./dsh --profile mcp add atlassian --label "Atlassian" --transport stdio \
    --command uvx --arg mcp-atlassian \
    --env JIRA_URL=https://<site>.atlassian.net \
    --env JIRA_USERNAME=<you@example.com> \
    --env CONFLUENCE_URL=https://<site>.atlassian.net/wiki \
    --env CONFLUENCE_USERNAME=<you@example.com> \
    --env TOOLSETS=all \
    --env-from JIRA_API_TOKEN=ATLASSIAN_API_TOKEN \
    --env-from CONFLUENCE_API_TOKEN=ATLASSIAN_API_TOKEN \
    --cwd "$HOME"

./dsh --profile mcp secret set ATLASSIAN_API_TOKEN   # paste, then ctrl-D
```

Note what goes where. URLs and usernames are `--env` and are stored in the
settings document in clear; the token is `--env-from`, which stores only the
*name* `ATLASSIAN_API_TOKEN` there and resolves the value at connect time from
the credential store or the environment. Jira and Confluence take the same
token, so one credential is named twice.

`TOOLSETS=all` is not decoration: `mcp-atlassian` warns that its default
changes to six core toolsets in v0.22.0, and `all` pins today's surface.

Exporting the token instead of storing it does not work on its own — the
subprocess seam scrubs every ambient name matching
`/KEY|PASSWORD|SECRET|TOKEN/i` out of a spawned child, so it must be named by a
connector either way. `secret status ATLASSIAN_API_TOKEN` says which layer is
supplying the value, which matters because an exported variable outranks the
stored one.

### The FastMCP banner

This route prints a FastMCP banner, an authlib deprecation warning, and a
`TOOLSETS` notice on every start. All of it is `mcp-atlassian`'s own output on
stderr, inherited by `dsh`; none of it indicates a problem, and it does not go
away by reconfiguring anything here. It goes away by using the remote route,
which spawns no Python at all.

## Verify either route

```sh
./dsh --profile mcp status atlassian --json
```

`health: connected` with a populated `tools` array is the whole check for the
stdio route. For the remote route also look for `oauth.authorized: true` and
`renewable: true` — the latter means a refresh token was issued, so the access
token's expiry is handled without another consent round.

Registering tools is not the same as authenticating: `mcp-atlassian` builds its
tool list from configuration alone, so a wrong token still yields 98 tools and
fails at the first call. If you want proof before trusting it, make one
read-only call.

## Moving from the local route to the remote one

Sign the remote connector in under a *different* id first, confirm its tool
coverage is enough for what you use, and only then retire the local one:

```sh
./dsh --profile mcp remove atlassian
./dsh --profile mcp secret unset ATLASSIAN_API_TOKEN
```

Then revoke the API token itself in Atlassian — a credential you have stopped
using is better revoked than left valid — and, if it ever sat in clear in a
profile's `cordis.patch.yml`, treat it as exposed rather than merely retired.

An id cannot be renamed in place: the stored grant is keyed to it, so moving
the remote connector onto the name `atlassian` afterwards costs a second
consent. Choosing the final id before the first sign-in avoids that.
