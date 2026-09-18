# Connecting Google Workspace — Gmail, Drive, Calendar

Google ships one remote MCP server per Workspace product. Three of them are
configured in this installation already:

| Connector | Endpoint | Scope requested | Tools |
|---|---|---|---|
| `gmail` | `https://gmailmcp.googleapis.com/mcp/v1` | `gmail.readonly` | 23 (`mcp__gmail__*`) |
| `drive` | `https://drivemcp.googleapis.com/mcp/v1` | `drive.readonly` | 8 (`mcp__drive__*`) |
| `calendar` | `https://calendarmcp.googleapis.com/mcp/v1` | `calendar.readonly` | 9 (`mcp__calendar__*`) |

All three publish RFC 9728 protected-resource metadata naming
`https://accounts.google.com/` as their authorization server, and all three
answer `tools/list` unauthenticated — which is why they already report
`health: connected` with their tools enumerated before anyone has signed in.
Tool *calls* need a bearer token, and that is the part below.

Google issues no OAuth client automatically and `accounts.google.com`
publishes no `registration_endpoint`, so RFC 7591 Dynamic Client Registration
is unavailable: a client registered by hand in a Google Cloud project is
mandatory, and only the account owner can create it. Everything in this
document is that part.

> Google's Workspace MCP servers are in **Developer Preview**. Enroll the
> account you will sign in as at <https://developers.google.com/workspace/preview>
> before starting, or the consent step can fail with no useful error.

## 1. Enable the APIs

Two distinct sets — the product APIs, and the MCP services that front them.
Both are required; enabling only the first is the usual cause of a
`PERMISSION_DENIED` that arrives *after* a successful sign-in.

```sh
gcloud services enable \
  gmail.googleapis.com drive.googleapis.com calendar-json.googleapis.com \
  --project PROJECT_ID

gcloud services enable \
  gmailmcp.googleapis.com drivemcp.googleapis.com calendarmcp.googleapis.com \
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
   ```

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
A client *secret* is required either way: `accounts.google.com` advertises only
`client_secret_post` / `client_secret_basic` token-endpoint auth.

One client serves all three connectors.

## 4. Give `dsh` the client

```sh
./dsh --profile mcp set gmail    --client-id <id>.apps.googleusercontent.com --client-secret <secret>
./dsh --profile mcp set drive    --client-id <id>.apps.googleusercontent.com --client-secret <secret>
./dsh --profile mcp set calendar --client-id <id>.apps.googleusercontent.com --client-secret <secret>
```

Add `--redirect-uri <uri>` to each if step 3 registered something other than
the default.

The secret never reaches `$DSH_HOME/settings.yaml`; it is written to the
credential seam under `mcp-connector/<id>`, along with the tokens that follow.

## 5. Sign in

```sh
./dsh --profile mcp login gmail
./dsh --profile mcp login drive
./dsh --profile mcp login calendar
```

Each opens a browser for consent and exits once the grant settles; each
connector holds its own grant, so one sign-in does not cover the other two.
On a machine with no browser — `dsh` over SSH, say — the command prints the
URL and accepts the redirected URL pasted back.

The GUI does the same thing: **Settings → MCP connectors → Sign in**.

## 6. Verify

```sh
./dsh --profile mcp status gmail --json    # oauth.authorized: true, renewable: true
./dsh --profile mcp list --json
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
| `EADDRINUSE` on the callback listener | Something already holds port 33418. Re-register a different port and `set --redirect-uri`. |
| `invalid_scope` at authorization | Scope requested but not listed on the consent screen (step 2). |
