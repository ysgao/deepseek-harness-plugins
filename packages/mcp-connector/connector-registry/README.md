# dsh-plugins-mcp-connector-registry

Owns the `mcp-connector` settings section, mounts one
`dsh-plugins-mcp-client-oauth` instance per enabled connector, and publishes
`ctx.mcpConnectors` for the RPC controller and the CLI.

Mounting from settings rather than from `cordis.yml` is what makes a connector
addable at runtime. A `cordis.yml` row is fixed at composition time, which is
right for a server that is part of the product and wrong for one a human — or
an agent running the CLI — adds to a session already under way. Both paths
remain available; this package adds a second one beside the first.

The mount half is a reconciliation loop, not a startup list: a connector added,
edited, enabled, or removed takes effect immediately, because `ctx.plugin()` is
just as available at minute ten as at boot. Reconciles are serialized on one
chain, so two settings commits landing together cannot each compute a swap from
the same starting state and have one dispose a fiber the other just created.

`inject` is `['settings', 'credentials']` — deliberately **not** `tools`. The
connector *list* is meaningful in a composition with no tool registry at all
(the CLI's own profile is exactly that); a mounted client instance declares
`tools` for itself and stays pending, harmlessly, as a nested fiber.

## Two halves, kept apart

The **definition** — id, label, transport, URL or command, headers, scopes — is
ordinary configuration and lives in the settings document, where a
configuration UI can read and write it and a human can hand-edit it. Nothing in
it is a secret, so the document stays safe to read, print, diff, and copy.

The **credentials** — OAuth client id and secret, access token, refresh token —
never touch that document. They live in the credential seam's record space
under `mcp-connector/<id>`, written only through `modifyRecord`.

A connector id folds to its credential-key segment (lower case, `_` → `-`), and
two ids that fold together are refused at write time rather than silently
sharing one stored authorization.

A **stdio** server keeps the same split through `envFrom`, which maps a child
environment variable to the *name* of a credential rather than to its value:

```yaml
- id: atlassian
  transport: stdio
  command: uvx
  args: ['mcp-atlassian']
  env:
    JIRA_URL: https://example.atlassian.net   # not a secret, stored in clear
  envFrom:
    JIRA_API_TOKEN: ATLASSIAN_API_TOKEN       # a name; the value is never here
```

The value is resolved once per mount through `ctx.credentials`, whose local
provider layers the inherited process environment over
`$DSH_HOME/.credentials.yaml` over the `.env` fallbacks — so the token can live
in a `0600` file the seam manages, or in the environment, and in neither case
in this document. Resolution is also what makes it arrive at all: the
subprocess seam scrubs every ambient name matching `/KEY|PASSWORD|SECRET|TOKEN/i`
out of a child's environment, so a token merely exported in the parent shell
never reaches the server on its own.

Two consequences worth knowing. A reference that resolves to nothing fails
that connector's mount and names what is missing, rather than starting the
server unauthenticated to fail every tool call later. And the mount signature
carries the mapping but never the value, so repointing a variable at another
credential remounts, while rotating the value behind a name takes effect at
the next mount rather than instantly.
