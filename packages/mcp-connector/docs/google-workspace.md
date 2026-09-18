# Connecting Google Workspace

Google ships one remote MCP server per Workspace product, at
`https://<product>mcp.googleapis.com/mcp/v1`. Seven exist:

| Connector | Product | Tools | Representative tools |
|---|---|---|---|
| `gmail` | Gmail | 23 | `search_threads`, `get_message`, `create_draft`, `send_message` |
| `calendar` | Calendar | 9 | `list_events`, `create_event`, `suggest_time` |
| `drive` | Drive | 8 | `search_files`, `read_file_content`, `create_file` |
| `sheets` | Sheets | 6 | `get_values`, `update_values`, `update_formulas` |
| `slides` | Slides | 4 | `read_presentation`, `read_slide_page`, `update_presentation` |
| `chat` | Chat | 4 | `list_messages`, `search_messages`, `send_message` |
| `docs` | Docs | 2 | `read_doc`, `update_doc` |

`tasks`, `forms`, `meet`, `keep`, `people` and `admin` have no such server —
their `…mcp.googleapis.com` hosts answer 404. A third-party server is the only
route to those products, and to deeper per-product tooling than the counts
above: `docsmcp` offers two tools where a community server offers a dozen. That
trade is about depth, not availability.

Those counts come from each server's own `tools/list`, read without
authenticating. Add only the products you use: every connector's tools land in
one model's tool list, and a tighter list is easier to choose from, not a
lesser installation.

## Read this before starting

Three facts decide whether the next hour goes well. Each one cost a session to
learn, and none is visible in the error it produces.

**A connector that says `connected` with its tools listed is telling you
nothing about authorization.** Google's servers answer `tools/list`
unauthenticated, so a freshly added connector looks healthy before anyone signs
in, and keeps looking healthy when the grant, the project, or the enrollment is
wrong. Only a real tool call tells you anything. Step 9 is not optional.

**The only project that counts is the one that owns the OAuth client**, which
is not necessarily the one `gcloud config` has selected. Google authorizes API
use against the client's project, so enabling an API anywhere else reports
success and changes nothing.

**Every sign-in requests every scope the server publishes.** A connector's
`--scope` does not narrow it — see [What decides the scopes you are asked
for](#what-decides-the-scopes-you-are-asked-for). Decide up front whether you
are willing to grant Gmail's full-mailbox scope, because the consent screen
is where that is settled, not the connector.

## 1. Apply to the Developer Preview — do this first

These servers are in Developer Preview, and the enrollment is of the **Cloud
project**, not merely of the account signing in. Apply at
<https://developers.google.com/workspace/preview>, giving the project number
from step 2.

There is no separate "enroll this project" control: the application form *is*
the enrollment. An existing member adds another project through that page's
*Request to add or remove your Google Cloud project* form.

This is first because it is the only step with a queue — Google's FAQ says to
expect an email "within a couple of days", where everything else here takes
minutes. Until it lands, every connector looks perfect and every tool call
returns *"Access to this tool requires that your Google Cloud project (NNN) is
enrolled in the Google Workspace Developer Preview"*. Two conditions stall an
application silently: your address must be addable to a Google Group, which a
managed domain's policy can forbid, and service accounts cannot be enrolled at
all.

## 2. Identify the project

If you already have an OAuth client, its id carries the owning project's
*number* as a prefix — `687081679312-v0cdf….apps.googleusercontent.com` belongs
to project number `687081679312`. Resolve it to an id:

```sh
gcloud projects list --filter="projectNumber=<the prefix>" --format="value(projectId)"
```

If you do not have one yet, create or pick a project now and use it for step 5
as well. Either way, pass it explicitly as `--project` everywhere below rather
than relying on `gcloud`'s default, which is easy to have pointed elsewhere and
which nothing downstream will warn you about.

## 3. Enable the APIs

Two distinct sets — the product APIs, and the MCP services that front them.
Both are required. Enabling only the first is the usual cause of a
`PERMISSION_DENIED` arriving *after* a successful sign-in.

```sh
# the product APIs — only the products you want connectors for
gcloud services enable \
  gmail.googleapis.com drive.googleapis.com calendar-json.googleapis.com \
  docs.googleapis.com sheets.googleapis.com slides.googleapis.com \
  --project PROJECT_ID

# and the MCP service fronting each one
gcloud services enable \
  gmailmcp.googleapis.com drivemcp.googleapis.com calendarmcp.googleapis.com \
  docsmcp.googleapis.com sheetsmcp.googleapis.com slidesmcp.googleapis.com \
  --project PROJECT_ID
```

## 4. Configure the consent screen

Console → **Google Auth Platform**:

1. **Branding** — app name, user support email, contact email.
2. **Audience** — pick *Internal* if the project is in a Workspace org. This is
   the choice that matters most: an Internal app needs no Google verification,
   has no user cap, and its refresh tokens do not expire on a timer. If only
   *External* is available, add yourself under **Test users** (consent is
   refused for an unverified app otherwise) and accept two limits until the app
   is verified — at most 100 test users, and **refresh tokens that expire after
   7 days**, so every connector needs signing in again weekly. Verification for
   `gmail.readonly` and `drive.readonly` also requires a CASA Tier 2 security
   assessment, because both are *restricted* scopes.
3. **Data Access** → *Add or remove scopes* → *Manually add scopes*. List every
   scope the servers you configured publish — not a read-only subset, because
   the request will ask for all of them and an unlisted scope is refused at
   authorization with `invalid_scope`. Read each server's list from its own
   metadata:

   ```sh
   for p in gmail drive calendar docs sheets slides; do
     echo "== $p"
     curl -s "https://${p}mcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1" \
       | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin)["scopes_supported"]))'
   done
   ```

   Look at what comes back before pasting it in. Gmail's list includes
   `https://mail.google.com/` — read, compose, send and delete on the whole
   mailbox. The document servers each ask for a Drive scope besides their own,
   so Drive's is shared rather than additional.

## 5. Create the OAuth client

Console → **Clients** → *Create client* → **Web application**. Under
*Authorized redirect URIs* add, byte for byte:

```
http://127.0.0.1:33418/mcp-oauth/callback
```

That is this plugin's default loopback redirect. The port is fixed rather than
ephemeral because RFC 6749 §3.1.2.3 has the authorization server compare
`redirect_uri` exactly against what was registered, so it must be known before
the attempt starts.

If the console refuses an `http://127.0.0.1` URI on a Web application client,
either use `http://localhost:33418/mcp-oauth/callback` (the loopback listener
binds whatever host the URI names) and pass it as `--redirect-uri` in step 7,
or create a **Desktop app** client instead, which accepts loopback redirects.

**If you use the Settings page from another machine**, register the web UI's
own callback instead — `https://<your dsh host>/mcp-oauth/callback` — and pass
it as `--redirect-uri`. The loopback listener runs on the `dsh` host, so a
browser elsewhere never reaches it; the web server answers that path itself and
completes the round trip from any browser that can open the UI. Google requires
`https` for a non-localhost redirect URI, so this needs the UI served over TLS.
One client can carry both URIs.

A client *secret* is required either way: `accounts.google.com` advertises only
`client_secret_post` / `client_secret_basic` token-endpoint auth. **One client
serves every connector.**

## 6. Add the connectors

```sh
./dsh --profile mcp add gmail    --label "Gmail"            --url https://gmailmcp.googleapis.com/mcp/v1
./dsh --profile mcp add drive    --label "Google Drive"     --url https://drivemcp.googleapis.com/mcp/v1
./dsh --profile mcp add calendar --label "Google Calendar"  --url https://calendarmcp.googleapis.com/mcp/v1
./dsh --profile mcp add docs     --label "Google Docs"      --url https://docsmcp.googleapis.com/mcp/v1
./dsh --profile mcp add sheets   --label "Google Sheets"    --url https://sheetsmcp.googleapis.com/mcp/v1
./dsh --profile mcp add slides   --label "Google Slides"    --url https://slidesmcp.googleapis.com/mcp/v1
```

`streamable-http-oauth` is the default transport, so it needs no flag. Each
will report `connected` with its tools immediately — see "Read this before
starting" for why that means nothing yet.

## 7. Give `dsh` the client

```zsh
read "CLIENT_ID?Client id: "
read -s "CLIENT_SECRET?Client secret: "; echo

for c in gmail drive calendar docs sheets slides; do
  ./dsh --profile mcp set "$c" --client-id "$CLIENT_ID" --client-secret "$CLIENT_SECRET"
done

unset CLIENT_SECRET
```

Reading the secret rather than typing it inline keeps it out of the shell
history and the process table; there is no stdin route for a client secret the
way `secret set` gives one for an API token. Settings → MCP connectors → Edit
takes the same two fields if you would rather not touch a shell at all.

Add `--redirect-uri <uri>` if step 5 registered something other than the
default. The secret never reaches `$DSH_HOME/settings.yaml`; it goes to the
credential seam under `mcp-connector/<id>`, with the tokens that follow.

## 8. Sign in — once per connector

Settings → MCP connectors → **Sign in** on each, or:

```sh
for c in gmail drive calendar docs sheets slides; do ./dsh --profile mcp login "$c"; done
```

The CLI prints the consent URL and waits; the Settings page renders it as a
link. Neither opens a browser for you, because the machine running `dsh` is
often not the machine you are sitting at.

**`clone-grant` does not work across these servers**, though it is the obvious
thing to reach for. Each authorization request carries an RFC 8707
`resource=https://<product>mcp.googleapis.com/mcp/v1` indicator, so Google
binds the token to one endpoint; and each server publishes only its own
product's scopes, so a Gmail grant carries nothing Drive or Calendar could use.
Six connectors mean six consent screens. (The feature is still right for a
provider that neither binds the resource nor splits its scopes.)

## 9. Verify — with a real call

```sh
./dsh --profile mcp list --json
```

Expect `health: connected`, `oauth.authorized: true`, and `renewable: true` on
every connector. `renewable` is the one to read twice: it means a refresh token
was issued, so the hourly access-token expiry is handled without another
consent round. This client asks Google for one explicitly (`access_type=offline`
plus `prompt=consent`, which Google requires and which is not part of OAuth
2.0); `renewable: false` on a Google connector means a build that predates
that.

Then make a call that needs the token, because everything above can be true
while the grant, the project or the enrollment is wrong:

> In the web UI, ask the agent to list your Gmail labels.

Real labels mean you are done. Anything else, see below.

## What decides the scopes you are asked for

Not the connector's `--scope`. The MCP SDK resolves the request as
`WWW-Authenticate scope` → the resource server's published `scopes_supported` →
the client metadata's scope, and a connector's configured scope only reaches
the last of those. Every Google server publishes `scopes_supported`, so it
always wins: **setting `--scope` on a Google connector changes nothing.**
Verified by comparing the authorization URL with and without it — byte for
byte identical, both asking for everything published.

Two consequences. The consent screen must list every published scope, or
authorization fails with `invalid_scope` (step 4). And a read-only grant is not
available through configuration here — if you need one, the lever is a
different OAuth client whose consent screen offers less, not a connector field.

`--scope` is still honoured for a server that publishes no protected-resource
metadata, which is why the field exists and why it is not documented as dead.

## Troubleshooting

| Symptom | Cause |
|---|---|
| A tool call says the project "is not enrolled in the Google Workspace Developer Preview" | Step 1 has not been approved yet, or named a different project. Enrollment is per project and takes days. |
| A tool call says the API "has not been used in project NNN before or it is disabled", for a project you did not configure | The APIs were enabled in the wrong project. `NNN` is the client id's numeric prefix — the project owning the client is the only one that counts. See steps 2 and 3. |
| One connector works and the rest fail identically | Same cause: that one product's MCP service is enabled in the client's project and the others are not. |
| Sign-in succeeds, tool calls return `PERMISSION_DENIED` | The `*mcp.googleapis.com` service is not enabled (step 3's second command), or the scope was never granted. |
| `invalid_scope` at authorization | The request asks for every published scope; the consent screen lists fewer. See step 4. |
| `renewable: false` after a successful sign-in | A build predating the `access_type=offline` request. Rebuild, restart, and sign in again. |
| `Invalid PKCE code_verifier` | A build predating the one-authorization-request-per-attempt fix, where a retrying mount minted a second verifier over the first. Rebuild and retry. |
| `redirect_uri_mismatch` | The registered URI differs from the connector's somewhere byte-exact — trailing slash, `localhost` vs `127.0.0.1`, port. |
| "Access blocked: app has not completed verification" | External audience without your account under *Test users*. |
| `EADDRINUSE` on the callback listener | Something already holds port 33418. Register a different port and `set --redirect-uri`. |

## Moving a grant between machines

The record is one entry in `$DSH_HOME/.credentials.yaml` under
`mcp-connector/<id>`, the file is watched for external edits, and a refresh
token is not machine-bound — the loopback redirect only matters while
authorizing. On a machine with no browser, `login` prints the URL and accepts
the redirected URL pasted back.
