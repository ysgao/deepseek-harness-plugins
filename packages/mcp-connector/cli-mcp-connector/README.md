# dsh-plugins-cli-mcp-connector

`dsh --profile mcp <command>` — list, add, edit, authorize, and remove MCP
connectors from the terminal.

Built for an agent first and a human second. An agent told "connect my Gmail"
runs `add`, then `login`, then `list --json`, and reads machine-parsable output
at every step — which is why every command takes `--json`, why `list --json`
prints one object with no prose around it, and why a refusal exits non-zero
with its reason on stderr rather than asking a follow-up question. The one
genuinely interactive command, `login`, is interactive only because OAuth
consent is: a human has to approve it in a browser, and no flag changes that.

```sh
dsh plugin --profile mcp add <path to this package>

# Google's official Gmail MCP server. Google publishes no OAuth Dynamic Client
# Registration endpoint, so a client registered in a Google Cloud project is
# required; scopes come from the server's own RFC 9728 metadata.
dsh --profile mcp add gmail --url https://gmailmcp.googleapis.com/mcp/v1 \
    --client-id <id>.apps.googleusercontent.com --client-secret <secret>
dsh --profile mcp login gmail

dsh --profile mcp add drive --url https://drivemcp.googleapis.com/mcp/v1 \
    --client-id <id>.apps.googleusercontent.com --client-secret <secret>

# A local stdio server, no authorization involved.
dsh --profile mcp add memory --transport stdio \
    --command npx --arg -y --arg @modelcontextprotocol/server-memory

dsh --profile mcp list --json
dsh --profile mcp status gmail --json
dsh --profile mcp logout gmail
dsh --profile mcp remove gmail
```

## One consent for a provider that ships several servers

Google splits its MCP surface across one server per product, so connecting
Gmail, Drive and Calendar means three connectors — but an authorization server
issues a grant for the *scopes* consented to, not for one endpoint. Sign one
connector in with every scope the set needs, then copy that grant to its
siblings:

```sh
dsh --profile mcp set gmail --scope "https://www.googleapis.com/auth/gmail.readonly \
    https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.readonly"
dsh --profile mcp login gmail
dsh --profile mcp clone-grant gmail drive calendar
```

`clone-grant` copies the tokens and the client pair that refreshes them, and
deliberately not the source's cached RFC 9728 discovery — the target is a
different resource and must discover its own. It refuses a source that is not
signed in, a target that already holds a grant, and a target whose configured
scopes the copied grant does not cover; the last two yield to `--force`.

Its own dedicated profile plugin rather than a subcommand of
`@deepseek-ai/dsh-headless`, for the reason `dsh-plugins-cli-login-app`
documents at length: `dsh-cmdline` lets any number of plugins parse the same
argument line independently, and `dsh-headless/startup`'s variadic `[task...]`
catch-all has no grammar that rejects `add gmail --url …`, so composing these
commands beside it would fire **both** — a real headless task run using `add`
as its literal prompt, racing the actual connector write.

The connector list lives in the shared settings document, so a connector added
here is the same connector the GUI's Settings → MCP connectors page shows, and
a sign-in completed in either place is stored once.
