# `dsh-plugins-host-oauth-callback-mcp-connector`

Receives MCP OAuth authorization redirects on the `dsh` web server, at
`/mcp-oauth/callback`, and hands each one to the sign-in attempt waiting for
it.

## Why

`dsh-plugins-mcp-client-oauth` catches the redirect with a loopback listener
bound on the machine running `dsh`. When the human's browser is on that same
machine — the ordinary desktop case — that is the best possible answer: no
extra plugin, no extra route, nothing reachable from outside the box.

It stops being an answer the moment the browser is somewhere else. The
authorization server redirects *that* browser, which resolves `127.0.0.1` to
its own machine, where nothing is listening. Two everyday setups land here:
`dsh` reached over SSH, and the web UI opened from a laptop against a `dsh`
running elsewhere. The sign-in still completes, by pasting the redirected URL
into a prompt, but a human who has to copy a URL carrying an authorization
code out of a browser is doing the plugin's job by hand.

A `dsh` that serves a web UI already runs a server every such browser can
reach. This plugin gives that server the callback route, so the code comes
back over the same origin the human is already using, and is redeemed
host-side exactly as before.

## Using it

Register the web origin's callback URL with the OAuth client alongside (or
instead of) the loopback one, and point the connector at it:

```sh
dsh --profile mcp set gmail --redirect-uri https://dsh.example.org/mcp-oauth/callback
```

Google requires `https` for any redirect URI that is not localhost, so this
path needs the web UI served over TLS. Nothing else changes: same client, same
scopes, same grant, same storage.

The connector's redirect URI decides which delivery runs. A `127.0.0.1` or
`localhost` URI keeps the loopback listener; a URI whose path is this route's
gets this one; the paste prompt races both, always, because neither can be
promised in every deployment.

## Shape

Two deliberate decisions, both about a plugin never taking `dsh` down
(CONSTITUTION.md Article V):

- **The service is published unconditionally; the route is not.** The sink is
  what `dsh-plugins-mcp-client-oauth` looks up through
  `ctx.get('mcpOAuthCallbacks')`. The route needs `webServer`, which a CLI
  profile does not have, so it is required through a nested `ctx.inject`
  rather than a top-level one — a top-level requirement would leave this entry
  pending forever there, which this repo's boot treats as fatal to the whole
  application rather than to one feature.
- **No `state` is minted or compared here.** The sink resolves whichever
  attempt registered that exact `state` and answers an unclaimed one with a
  page saying so. The nonce check stays in the flow that minted it, the only
  place that knows what it sent.

Responses carry `cache-control: no-store` and `referrer-policy: no-referrer`:
the URL being answered has an authorization code in it.
