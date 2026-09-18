# dsh-plugins-client-ui-settings-mcp-connector

Settings → **MCP connectors**: one row per configured connector with its mount
state and contributed tools, an add/edit card, and the sign-in affordance for
an OAuth connector.

**Additive, not a replacement.** `settings.section` is a pristine
`kind: 'list'` slot that `@deepseek-ai/dsh-client-ui-settings` declares for a
feature owning its own settings page, so nothing here disables a vendor row,
nothing is forked, and this package has no replacement-parity obligation of the
kind the Models sign-in panel carries. It still registers at `priority: -1`,
matching this repo's other settings registrations, so a same-slot collision
shadows deterministically rather than throwing, and the registration is
individually try/catch-guarded.

**Sign in is never disabled for want of a stored OAuth client.** It used to be,
which silently made every self-registering server unreachable from this page:
such a server has no client to configure and mints one during the attempt. A
server that does need one by hand says so when the attempt fails, in the same
sentence the CLI prints — `connector-registry`'s `signInFailure`, rendered here
from the error the Remote controller raises — and the row's hint says a client
may not be needed at all rather than ordering one to be added first.

The sign-in half renders `ctx.authorization`'s neutral notice/prompt vocabulary
and knows nothing about OAuth itself — the posture that seam documents ("a
surface that renders one flow renders all of them"). The consent URL, the paste
fallback, and any future device-code or pick-an-account step all arrive as
notices and prompts without this package changing.

`remote.mcpConnectors` is required through a **nested** `ctx.inject()` inside an
already-satisfied `apply()`, never the top-level `inject` array: a top-level
entry left pending forever is as fatal to this repo's Client boot as a thrown
exception, while a nested fiber is invisible to that audit and may stay pending
with no effect beyond this one page being absent.

The Client-side runtime registers as `ctx.mcpConnectorsClient`, not
`ctx.authorization` — `dsh-plugins-client-ui-settings-anthropic-subscription`
already provides a Client service under that name, and two providers of one
name is a hard Cordis conflict, so a profile carrying both bundles would fail
to boot if this one squatted there. It is also not `ctx.mcpConnectors`: that
name belongs to the Host registry, which is a different object with a different
shape.

The page owns one CSS Module of its own and imports no other plugin's
internals, so the bundle needs no `extraInlineSafe` purity-gate widening. Its
geometry (720px column, 16px card radius, 0.5px `--dsw-alias-border-l4`
hairline) deliberately matches the Models section so the two settings pages
read as one design rather than as two plugins.
