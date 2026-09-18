# Connecting Google Workspace — Gmail, Drive, Calendar

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
trade is a real one, and it is about depth, not availability.

Those counts come from each server's own `tools/list`, read without
authenticating. Add only the products you use: every connector's tools land in
one model's tool list, and a tighter list is easier to choose from, not a
lesser installation.

All of them publish RFC 9728 protected-resource metadata naming
`https://accounts.google.com/` as their authorization server, and all of them
answer `tools/list` unauthenticated — which is why a freshly added one reports
`health: connected` with its tools enumerated before anyone has signed in. Tool
*calls* need a bearer token, and that is the part below.

Google issues no OAuth client automatically and `accounts.google.com`
publishes no `registration_endpoint`, so RFC 7591 Dynamic Client Registration
is unavailable: a client registered by hand in a Google Cloud project is
mandatory, and only the account owner can create it. Everything in this
document is that part.

> Google's Workspace MCP servers are in **Developer Preview**. Enroll the
> account you will sign in as at <https://developers.google.com/workspace/preview>
> before starting, or the consent step can fail with no useful error.

## 1. Enable the APIs

**In the project that owns the OAuth client**, which is not necessarily the one
`gcloud` has selected. Google bills and authorizes API use against the client's
project, so enabling an API anywhere else changes nothing and reports success
while doing it. The client id carries that project's *number* as its prefix —
`687081679312-v0cdf….apps.googleusercontent.com` belongs to project number
`687081679312` — which resolves to a project id like this:

```sh
gcloud projects list --filter="projectNumber=<the prefix>" --format="value(projectId)"
```

Pass that id as `--project` below and everywhere else in this document. The
symptom when this is wrong is unusually unhelpful: sign-in succeeds, the
connector reports `connected` with its tools listed — that listing is
unauthenticated and says nothing about your project — and the first real tool
call returns "*API has not been used in project NNN before or it is disabled*",
naming a project number you never typed.

Two distinct sets — the product APIs, and the MCP services that front them.
Both are required; enabling only the first is the usual cause of a
`PERMISSION_DENIED` that arrives *after* a successful sign-in.

```sh
# the product APIs — add only what you configured connectors for
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

## 2. Configure the consent screen

Console → **Google Auth Platform**:

1. **Branding** — app name, user support email, contact email.
2. **Audience** — pick *Internal* if the project is in a Workspace org. This
   is the choice that matters most: an Internal app needs no Google
   verification, has no user cap, and its refresh tokens do not expire on a
   timer. If only *External* is available, add yourself under **Test users**
   (consent is refused for an unverified app otherwise) and accept two limits
   until the app is verified — at most 100 test users, and **refresh tokens
   that expire after 7 days**, so every connector needs signing in again
   weekly. Verification for `gmail.readonly` and `drive.readonly` also
   requires a CASA Tier 2 security assessment, because both are *restricted*
   scopes.
3. **Data Access** → *Add or remove scopes* → *Manually add scopes*:

   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/calendar.readonly
   https://www.googleapis.com/auth/documents.readonly
   https://www.googleapis.com/auth/spreadsheets.readonly
   https://www.googleapis.com/auth/presentations.readonly
   ```

   Each server publishes its own `scopes_supported`, and the document
   servers ask for a Drive scope besides their own — `docs`, `sheets` and
   `slides` each list `drive.readonly` alongside `documents.readonly`,
   `spreadsheets.readonly` and `presentations.readonly`. Drive's scope is
   therefore shared rather than additional. Writing needs the non-readonly
   form of each (`documents`, `spreadsheets`, `presentations`, and `drive` or
   `drive.file`); see "Read-only, and how to widen later".

   Keep this list and the connectors' own `scope` fields in sync — a scope the
   connector requests but the consent screen does not list is refused at
   authorization time, not at call time.

## 3. Create the OAuth client

Console → **Clients** → *Create client* → **Web application**. Under
*Authorized redirect URIs* add, byte for byte:

```
http://127.0.0.1:33418/mcp-oauth/callback
```

That is this plugin's default loopback redirect. The port is fixed rather than
ephemeral because RFC 6749 §3.1.2.3 has the authorization server compare
`redirect_uri` exactly against what was registered, so it has to be known
before the attempt starts.

If the console refuses an `http://127.0.0.1` URI on a Web application client,
either use `http://localhost:33418/mcp-oauth/callback` (the loopback listener
binds whatever host the URI names) and pass it as `--redirect-uri` in step 4,
or create a **Desktop app** client instead, which accepts loopback redirects.

**If you use the Settings page from another machine**, register the web UI's
own callback instead — `https://<your dsh host>/mcp-oauth/callback` — and pass
it as `--redirect-uri`. The loopback listener runs on the `dsh` host, so a
browser elsewhere never reaches it and the sign-in falls back to pasting the
redirected URL by hand; the web server answers that path itself and completes
the round trip from any browser that can open the UI. Google requires `https`
for a non-localhost redirect URI, so this needs the UI served over TLS. One
client can carry both URIs.
A client *secret* is required either way: `accounts.google.com` advertises only
`client_secret_post` / `client_secret_basic` token-endpoint auth.

One client serves all three connectors.

## 4. Give `dsh` the client

```sh
for c in gmail drive calendar docs sheets slides; do
  ./dsh --profile mcp set "$c" \
      --client-id <id>.apps.googleusercontent.com --client-secret <secret>
done
```

Add `--redirect-uri <uri>` to each if step 3 registered something other than
the default.

The secret never reaches `$DSH_HOME/settings.yaml`; it is written to the
credential seam under `mcp-connector/<id>`, along with the tokens that follow.

## 5. Sign in

```sh
./dsh --profile mcp login gmail      # …and once per other connector, or see below
```

Each prints the consent URL and exits once the grant settles; each connector
holds its own grant. Nothing opens a browser for you — the machine running
`dsh` is often not the machine you are sitting at, and a consent page opened on
the wrong host helps nobody.

**Or consent once for the whole set.** A Google grant carries the scopes it was
approved for rather than one endpoint, so one sign-in can cover every
connector:

```sh
./dsh --profile mcp set gmail --scope "\
    https://www.googleapis.com/auth/gmail.readonly \
    https://www.googleapis.com/auth/drive.readonly \
    https://www.googleapis.com/auth/calendar.readonly \
    https://www.googleapis.com/auth/documents.readonly \
    https://www.googleapis.com/auth/spreadsheets.readonly \
    https://www.googleapis.com/auth/presentations.readonly"
./dsh --profile mcp login gmail
./dsh --profile mcp clone-grant gmail drive calendar docs sheets slides
```

The trade is that the `gmail` connector then *asks* for every scope in the set,
which is what the consent screen will show. If a tool call afterwards fails with an
audience or resource error, Google has bound that token to one resource after
all — sign the other two in separately and nothing else changes.

The same copy moves a grant between machines: the record is one entry in
`$DSH_HOME/.credentials.yaml` under `mcp-connector/<id>`, the file is watched
for external edits, and a refresh token is not machine-bound — the loopback
redirect only matters while authorizing.
On a machine with no browser — `dsh` over SSH, say — the command prints the
URL and accepts the redirected URL pasted back.

The GUI does the same thing: **Settings → MCP connectors → Sign in**, which
renders the same URL as a link. That button is never disabled for want of a
client; if you click it before step 4, the attempt fails with the same sentence
this document's step 3 exists to prevent — naming both the field to fill in and
the `set --client-id` command.

## 6. Verify

```sh
./dsh --profile mcp status gmail --json    # oauth.authorized: true, renewable: true
./dsh --profile mcp list --json           # every connector, its health and tool count
```

`renewable: true` means a refresh token was issued — the hourly access-token
expiry is handled without another consent round.

## Read-only, and how to widen later

The scopes above are read-only. Write tools (`create_draft`, `create_file`,
`create_event`, …) are still published, because the tool list comes from the
server rather than from the grant, and they fail at call time with a
permission error. To widen, add the scope to the consent screen first, then:

```sh
./dsh --profile mcp set gmail --scope "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"
./dsh --profile mcp logout gmail
./dsh --profile mcp login gmail
```

A stored grant carries the scopes it was issued with, so widening the request
without a fresh sign-in changes nothing.

Each server's full `scopes_supported` list is its own metadata document:

```sh
curl -s https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | The registered URI differs from the connector's, somewhere byte-exact — trailing slash, `localhost` vs `127.0.0.1`, port. |
| "Access blocked: app has not completed verification" | External audience without your account under *Test users*. |
| Sign-in succeeds, tool calls return `PERMISSION_DENIED` | The `*mcp.googleapis.com` service is not enabled (step 1's second command), or the scope was never granted. |
| A tool call says the API "has not been used in project NNN before or it is disabled", for a project you did not configure | The APIs were enabled in the wrong project. `NNN` is the client id's numeric prefix — the project that owns the OAuth client, which is the only one that counts. See step 1. |
| One connector works and the rest fail identically | Same cause: that one product's MCP service happens to be enabled in the client's project and the others are not. |
| `EADDRINUSE` on the callback listener | Something already holds port 33418. Re-register a different port and `set --redirect-uri`. |
| `invalid_scope` at authorization | Scope requested but not listed on the consent screen (step 2). |
