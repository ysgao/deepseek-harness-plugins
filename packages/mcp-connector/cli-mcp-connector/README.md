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
It prints the consent URL rather than opening a browser itself — the machine
running `dsh` is often not the machine the human is sitting at.

`login` does not require a client to be configured first. A server that
publishes an RFC 7591 registration endpoint mints one during the attempt; one
that does not says so when the attempt fails, and that failure carries the
`set --client-id` command. See "Which servers need a client by hand" below.

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

# A local stdio server that authenticates with an API token. --env is stored
# in clear and --env-from names a credential instead, so the token itself goes
# to the credential store — read from stdin, so it misses the shell history.
dsh --profile mcp add atlassian --transport stdio \
    --command uvx --arg mcp-atlassian \
    --env JIRA_URL=https://example.atlassian.net \
    --env-from JIRA_API_TOKEN=ATLASSIAN_API_TOKEN
dsh --profile mcp secret set ATLASSIAN_API_TOKEN     # paste, then ctrl-D
dsh --profile mcp secret status ATLASSIAN_API_TOKEN  # set? from which layer?
dsh --profile mcp secret unset ATLASSIAN_API_TOKEN

dsh --profile mcp list --json
dsh --profile mcp status gmail --json
dsh --profile mcp logout gmail
dsh --profile mcp remove gmail
```

## One consent for a provider that ships several servers

An authorization server issues a grant for the *scopes* consented to rather
than for one endpoint, so a provider that splits its MCP surface across several
servers can sometimes be reached with a single consent: sign one connector in,
then copy that grant to its siblings.

```sh
dsh --profile mcp login example-a
dsh --profile mcp clone-grant example-a example-b example-c
```

**Google is not such a provider**, despite being the obvious candidate. Its
authorization requests carry an RFC 8707 `resource=` indicator binding each
token to one MCP endpoint, and each of its servers publishes only its own
product's scopes, so a Gmail grant carries nothing Drive could use. Sign in to
each Google connector separately; `docs/google-workspace.md` covers it.

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

## Which servers need a client by hand

Two kinds of authorization server, distinguishable only by asking:

- **Self-registering** — publishes an RFC 7591 `registration_endpoint`, so the
  first sign-in mints a client and stores it. Nothing to create, nothing to
  paste. Atlassian's `https://mcp.atlassian.com/v1/mcp` is one.
- **Not** — `accounts.google.com` publishes no such endpoint, so a client
  created by hand in a Google Cloud project is mandatory, secret included.
  [`../docs/google-workspace.md`](../docs/google-workspace.md) is the
  procedure.

Which one a given server is cannot be known before trying, so this CLI does not
refuse in advance. When registration is genuinely the missing piece, the
failure says so and names both routes — the Settings field and the `set
--client-id` command — from the one `signInFailure` the Settings page renders
too.

## Secrets, and where they are not

`--env` is stored in the settings document in clear, so it is for a URL or a
username. `--env-from NAME=REF` names a credential instead, and the value is
resolved at connect time from the credential store or the environment:

```sh
dsh --profile mcp secret set ATLASSIAN_API_TOKEN     # reads stdin; paste, ctrl-D
dsh --profile mcp secret status ATLASSIAN_API_TOKEN  # set? which layer supplies it?
dsh --profile mcp secret unset ATLASSIAN_API_TOKEN
```

`secret set` reads standard input by default so the value misses the shell
history and the process table. It also reports when what you just stored is
*shadowed*: the local credential provider ranks the inherited process
environment above its own file, so an exported variable of the same name wins
over the stored one.
