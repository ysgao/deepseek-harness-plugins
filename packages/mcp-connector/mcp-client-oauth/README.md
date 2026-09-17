# dsh-plugins-mcp-client-oauth

An MCP client bridge that is a **superset** of `@deepseek-ai/dsh-mcp-client`,
plus OAuth 2.0 authorization-code and unattended token refresh for remote
Streamable HTTP MCP servers.

## Superset, not a competitor

Everything `dsh-mcp-client` does, this does, with the same names:

| | `dsh-mcp-client` | this package |
|---|---|---|
| `transport: 'stdio'` | yes | yes — same `command`/`args`/`env`/`cwd`, same `scrubbedParentEnv()` scrub |
| `transport: 'streamable-http'` | yes | yes — same `url`/`headers` |
| `transport: 'streamable-http-oauth'` | — | **new** |
| `serverName` reservation, reconnect policy, `maxInstructionBytes`, `failOnStartupError`, `toolCallTimeoutMs` | yes | identical fields and defaults |
| model-facing tool names | `mcp__<serverName>__<rawName>` | identical, hash-suffix rule included |
| `mcpResources` / `systemPrompt` publication | yes | yes |

A server moved across keeps working without a config edit, and keeps the exact
tool names it already had — a rename would silently invalidate every prompt,
transcript, and allowlist referring to them.

## What is forked, and why exactly that much

`connection.ts` and `transport.ts` are forked from the vendor package;
`tool-bridge.ts` and `server-context.ts` are short reimplementations.

The fork exists for one reason: `createTransport` is reached through a plain
relative import that no configuration seam can redirect, so adding a transport
case means owning the file that calls it. Every line of the supervision logic
in `connection.ts` — generation ownership, the close barrier, the serialized
sync chain, the outage budget — is the vendor's, unchanged; three marked points
differ (the transport factory, the tool bridge, and threading the OAuth
provider through). See that file's own doc comment.

`tool-bridge.ts` reimplements `publicToolName` and `syncTools` — about seventy
lines — over the vendor's own **exported** `createMcpToolDefinition`, which is
where all the difficulty lives (canonical result schema, image-attachment
projection, PTC structured content, untrusted-content narrowing). It is a
reimplementation rather than an import because the vendor keeps those two
behind its `./src/*` export, and a `./src/*` import resolves to a raw `.ts`
file that plain Node ESM cannot load at runtime. (A browser-bundled Client
package inlines such an import — which is why this repo's Settings UI packages
can use that export and a Host package cannot.)

Both forked files are recorded in `scripts/replacement-parity.json` so a vendor
pin bump forces them to be re-read against their moved originals.

## How the OAuth half works

The protocol is not reimplemented. The MCP SDK already owns RFC 9728 resource
discovery, authorization-server metadata discovery, PKCE, the code exchange,
the refresh grant, and the 401 → refresh → retry-once dance inside the
transport. What a host must supply is the half the SDK leaves abstract:

- **where credentials are persisted** — `oauth/store.ts`, over
  `ctx.credentials`'s record space, every write through `modifyRecord` so a
  refresh-token rotation is safe across processes;
- **how a human is asked to approve a redirect** — `oauth/flow.ts`, a
  `ctx.authorization` flow that races a loopback callback listener
  (`oauth/callback.ts`) against a paste-the-URL prompt, retiring the loser
  through the prompt's own `signal`, exactly as that seam documents.

Outside a running attempt there is no redirect handler installed, and the SDK
asking for one throws `McpReauthorizationRequiredError` instead — a tool call
at three in the morning must refresh silently or fail, never try to open a
consent page nobody is watching.

`ctx.authorization` is required through a **nested** `ctx.inject()`, never the
top-level `inject` array: a stdio or static-header connector needs no
authorization seam at all, and in this repo a top-level entry left pending
forever is fatal to the whole application rather than to one feature. A
composition without the seam keeps every already-stored token working,
refreshes included; only signing in afresh is unavailable.

## Configuration

```yaml
- name: dsh-plugins-mcp-client-oauth
  config:
    transport: streamable-http-oauth
    serverName: gmail
    url: https://gmailmcp.googleapis.com/mcp/v1
    label: Gmail
    oauth:
      clientId: '…apps.googleusercontent.com'
      clientSecret: '…'
      redirectUri: http://127.0.0.1:33418/mcp-oauth/callback
```

A connector mounted by `dsh-plugins-mcp-connector-registry` leaves
`clientId`/`clientSecret` out of config entirely and keeps them in the
credential record beside the tokens; the provider reads whichever is present,
preferring config so a pasted-in client id takes effect on the next sign-in.

The redirect URI's port is fixed rather than ephemeral because RFC 6749
§3.1.2.3 has the authorization server compare `redirect_uri` byte for byte
against what the client registered.
