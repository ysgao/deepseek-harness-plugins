/**
 * Wire-safe OAuth vocabulary for a remote Streamable HTTP MCP server: the
 * per-connector OAuth configuration, and the shape of the `GrantRecord`
 * payload this package persists through `ctx.credentials`.
 *
 * Types only — no runtime code and no Cordis import — so the Client
 * compilation face can read the same declarations the Host writes.
 *
 * @module dsh-plugins-mcp-client-oauth/oauth/types
 */

import type {
  OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens,
} from '@modelcontextprotocol/client'

/**
 * The OAuth 2.0 client half of one connector, as a human configures it.
 *
 * `clientId`/`clientSecret` are optional because the two ways a client is
 * obtained are mutually exclusive, not layered: an authorization server that
 * offers RFC 7591 Dynamic Client Registration mints its own pair on first
 * use, and one that does not (Google's `accounts.google.com` publishes no
 * `registration_endpoint` at all) can only be used with a pair the human
 * registered by hand. Leaving both unset selects DCR and fails loud against a
 * server that cannot do it, rather than silently sending an empty client_id.
 */
export interface McpOAuthConfig {
  /**
   * Registered OAuth client id. Omit only when the authorization server
   * supports Dynamic Client Registration.
   */
  clientId?: string
  /**
   * Registered OAuth client secret. Required by an authorization server whose
   * `token_endpoint_auth_methods_supported` excludes `none` — Google's does
   * (`client_secret_post`/`client_secret_basic` only), including for its
   * "Desktop app" client type, where the value is a shipped-with-the-app
   * identifier rather than a genuine secret.
   */
  clientSecret?: string
  /**
   * Redirect URI the authorization server sends the code back to. Must match
   * a URI registered with the client exactly — an authorization server
   * compares this byte for byte, so its port cannot be picked at runtime the
   * way an ephemeral loopback listener normally would. This package binds a
   * loopback listener to exactly this URI's host and port for the duration of
   * one attempt.
   */
  redirectUri: string
  /**
   * Scopes to request, space-separated. Omitted defers to the Scope Selection
   * Strategy — the `scopes_supported` list the resource server publishes in
   * its RFC 9728 metadata. Google's Gmail and Drive MCP servers both publish
   * one, so the common case needs no scope configuration at all.
   */
  scope?: string
  /**
   * Human-facing client name sent in Dynamic Client Registration. Ignored
   * when `clientId` is configured.
   */
  clientName?: string
}

/**
 * The `GrantRecord.payload` this package writes for one connector.
 *
 * Everything the OAuth flow must remember between attempts lives in this one
 * record so that a single `ctx.credentials.modifyRecord` read-decide-replace
 * covers the whole set atomically. That matters most for the refresh leg:
 * `modifyRecord` holds its exclusion across processes where the backing store
 * supports it, so two `dsh` processes rotating one refresh token concurrently
 * cannot lose whichever wrote first — the exact hazard the credential seam's
 * own documentation names for this operation.
 */
export interface McpOAuthGrant {
  /** Payload shape discriminant, so a future migration can recognize this one. */
  version: 1
  /** Tokens as the SDK persisted them, `issuer` stamp included. */
  tokens?: StoredOAuthTokens
  /** Client credentials, either configured by hand or minted by Dynamic Client Registration. */
  clientInformation?: StoredOAuthClientInformation
  /**
   * Whether {@link clientInformation} came from a human rather than from
   * Dynamic Client Registration.
   *
   * The distinction is not cosmetic: the SDK calls
   * `invalidateCredentials('client')` when a server rejects the client, and
   * discarding a DCR-minted registration is right (the next attempt mints
   * another) while discarding a hand-registered pair is not — nothing can
   * recreate it, so it would turn a "consent again" into a "go find your
   * client id again". A connector configured through the registry stores its
   * pair here rather than in settings, so that the client secret stays in the
   * credential store with the tokens instead of in a settings document.
   */
  clientConfigured?: boolean
  /** PKCE verifier for the attempt currently mid-redirect; cleared once the code is redeemed. */
  codeVerifier?: string
  /** Cached RFC 9728 + authorization-server discovery, so a later attempt skips the round trips. */
  discoveryState?: OAuthDiscoveryState
  /** Epoch milliseconds at which {@link tokens} was written, for a "signed in since" surface. */
  obtainedAt?: number
}

/** How a connector's stored authorization currently stands, for a listing surface — never a token. */
export interface McpOAuthStatus {
  /** Whether a token set is stored at all. */
  authorized: boolean
  /**
   * Whether an OAuth client id is available — configured by hand or minted by
   * Dynamic Client Registration. A surface shows "add a client id" rather
   * than "sign in" while this is false and the authorization server offers no
   * dynamic registration, which is the case for Google's.
   */
  clientConfigured: boolean
  /** The configured client id, which is a public identifier; the secret is never reported. */
  clientId?: string
  /** Whether that token set can be renewed without the human, i.e. a refresh token is stored. */
  renewable: boolean
  /** Epoch milliseconds the stored access token expires at, when the server said. */
  expiresAt?: number
  /** Epoch milliseconds the stored token set was written at. */
  obtainedAt?: number
  /** Scopes the authorization server actually granted, when it echoed them. */
  scope?: string
}
