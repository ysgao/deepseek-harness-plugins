# Connecting Atlassian — Jira and Confluence

Two routes, and they are genuinely different trades rather than one being a
worse version of the other.

| | Remote (`streamable-http-oauth`) | Local (`stdio`) |
|---|---|---|
| Server | Atlassian's `https://mcp.atlassian.com/v2/mcp` | `uvx mcp-atlassian`, a Python server built on FastMCP |
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
    --url https://mcp.atlassian.com/v2/mcp
./dsh --profile mcp login atlassian
```

That is the whole configuration. There is no client id to create: `/v2/mcp`
publishes an RFC 9728 protected-resource document naming its authorization
server as a per-tenant host under `auth.atlassian.com`, not `mcp.atlassian.com`
itself —

```console
$ curl -s https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp \
    | jq '{resource, authorization_servers, scopes_supported: (.scopes_supported | length)}'
{"resource": "https://mcp.atlassian.com/v2/mcp",
 "authorization_servers": ["https://auth.atlassian.com/<tenant>"],
 "scopes_supported": 38}
```

— and that authorization server publishes a `registration_endpoint`, so the
first sign-in registers a client itself and stores it in the credential
record, PKCE `S256`, alongside the tokens. Nothing to paste, no console, and
nothing for a second machine to copy but the grant.

Until that sign-in completes the connector reads `health: failed` with no
tools. That is not an error — an OAuth connector contributes nothing before it
is authorized, and unlike Google's servers this one answers an unauthenticated
request with `401`, so there is nothing to enumerate in the meantime.

Two facts about v2 worth knowing, because both read differently from v1 (see
"Moving off `/v1/mcp`" below) and from the Google case:

- Unlike v1, it publishes an RFC 9728 protected-resource document and a full
  `scopes_supported` list, so nothing needs `--scope` by default.
- Its authorization server is a different **host** from the resource server
  (`auth.atlassian.com`, not `mcp.atlassian.com`) and from one Atlassian site
  to the next (the path segment after it is per-tenant) — worth knowing before
  assuming an authorization URL seen once is the same for every site.

### Moving off `/v1/mcp`

A connector still pointed at `https://mcp.atlassian.com/v1/mcp` keeps working
today, but Atlassian's own migration notice says v1 traffic starts exposing v2
behavior automatically from March 1, 2027, and names the fix for a client that
breaks when that happens as clearing its "cached clientIds or `.well-known`
credentials" — because v1 and v2 are different OAuth resources with different
authorization servers, and a client or token obtained against one is not
valid against the other.

Editing the connector's `--url` from v1 to v2 (or back) is exactly this
package's `discoveredFor` guard: a cached RFC 9728 and authorization-server
discovery is only ever reused for the URL it was discovered under, so an
edited URL re-discovers rather than keeps signing in through the old
resource's authorization server with its client. The registry remounts on
every definition edit, so that re-discovery runs within the same edit —
including registering a fresh client against the new authorization server,
unattended, since this server supports Dynamic Client Registration. The
tokens obtained under the old URL are left in the credential record rather
than discarded (nothing in the OAuth flow calls back in to erase them), but
`status` stops reporting them as `authorized` the moment their issuer stamp
no longer matches the freshly-registered client's — which is immediately
after that first remount, not after a tool call fails. Signing out
(`./dsh --profile mcp logout atlassian`) after an edit clears both the stale
tokens and the superseded discovery cache outright, rather than leaving them
in the record unauthorized but present.

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
