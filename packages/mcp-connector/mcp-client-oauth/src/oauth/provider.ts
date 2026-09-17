/**
 * The `OAuthClientProvider` the MCP SDK drives, backed by `ctx.credentials`.
 *
 * This is the whole of what `@deepseek-ai/dsh-mcp-client` does not have. That
 * package offers exactly two authentication shapes — a spawned stdio child
 * with env vars, or a Streamable HTTP URL with a static `headers` dictionary —
 * and a static header cannot carry a bearer token that expires hourly, which
 * is what Google's Gmail and Drive MCP servers (and every other OAuth-gated
 * remote MCP server) issue. Nothing about that is a gap in this repo's copy of
 * the harness: `packages/mcp/mcp-client/src/transport.ts` at the pinned
 * revision builds its `StreamableHTTPClientTransport` with
 * `{ requestInit: { headers: config.headers } }` and passes no `authProvider`
 * at all, so there is no authorization-code leg and no refresh anywhere in it.
 *
 * The protocol itself is not reimplemented here. The MCP SDK already owns
 * RFC 9728 resource discovery, authorization-server metadata discovery, PKCE,
 * the code exchange, the refresh grant, and the 401-refresh-retry-once dance
 * inside the transport. What a host has to supply is the half the SDK
 * deliberately leaves abstract: where credentials are persisted, and how a
 * human is asked to approve a redirect. This class supplies the first through
 * {@link McpOAuthStore} and the second through {@link RedirectHandler}, which
 * the `ctx.authorization` flow installs for the duration of one attempt.
 *
 * @module dsh-plugins-mcp-client-oauth/oauth/provider
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  OAuthClientInformationContext, OAuthClientMetadata, OAuthClientProvider, OAuthDiscoveryState,
  StoredOAuthClientInformation, StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import { McpOAuthStore } from './store.ts'
import type { McpOAuthConfig } from './types.ts'

/**
 * What a running `ctx.authorization` attempt installs so the SDK can reach
 * the human. Absent outside an attempt, which is deliberate: a tool call that
 * 401s at three in the morning must refresh silently or fail, never try to
 * open a consent page nobody is watching.
 */
export type RedirectHandler = (authorizationUrl: URL) => void | Promise<void>

/**
 * Raised when the SDK asked to redirect a human and no attempt is running.
 *
 * Distinguished from an ordinary transport failure on purpose: this is the
 * one error a surface can act on, by offering the Sign in button again. The
 * refresh grant having expired or been revoked is the ordinary way to get
 * here, months after the human last touched the connector.
 */
export class McpReauthorizationRequiredError extends Error {
  /** Stable machine code for a wire layer mapping this to its own taxonomy. */
  readonly code = 'MCP_REAUTHORIZATION_REQUIRED'

  /** @param serverName - the connector whose stored authorization is no longer usable. */
  constructor(readonly serverName: string) {
    super(
      `mcp-client-oauth(${serverName}): the stored authorization can no longer be renewed without the human — `
      + 'sign in again from Settings > MCP connectors, or run `dsh --profile mcp login ' + serverName + '`',
    )
    this.name = 'McpReauthorizationRequiredError'
  }
}

/** Grant types this client asks for; the refresh grant is what makes the hourly rotation unattended. */
const GRANT_TYPES = ['authorization_code', 'refresh_token']

/**
 * Persisted-credential and human-interaction half of the MCP SDK's OAuth
 * client, for one connector.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private readonly store: McpOAuthStore
  /**
   * Installed only while a `ctx.authorization` attempt is running. Mutable
   * rather than constructor-injected because the provider outlives any one
   * attempt: it is built once per connection generation and keeps refreshing
   * tokens long after the attempt that first obtained them finished.
   */
  private redirectHandler: RedirectHandler | undefined
  /**
   * The `state` parameter of the attempt currently mid-redirect. Installed by
   * the same call that installs {@link redirectHandler}, because the two are
   * halves of one thing: the value the authorization server will echo back to
   * the loopback listener, which is what lets the listener tell this attempt's
   * callback from an unrelated request that merely found the open port.
   */
  private pendingState: string | undefined

  /**
   * @param ctx - context carrying `ctx.credentials`.
   * @param serverName - the connector this provider authorizes.
   * @param config - the human-configured OAuth client half.
   */
  constructor(
    ctx: Context,
    private readonly serverName: string,
    private readonly config: McpOAuthConfig,
  ) {
    this.store = new McpOAuthStore(ctx, serverName)
  }

  /** The credential record this provider reads and writes. */
  get credentialKey(): McpOAuthStore['key'] {
    return this.store.key
  }

  /**
   * Install the human-facing redirect handler, and the `state` nonce that
   * attempt's callback must echo, for the duration of one authorization
   * attempt.
   * @param handler - called with the authorization URL the human must open.
   * @param state - the CSRF nonce to send as the `state` parameter.
   * @returns disposer restoring the unattended posture.
   */
  withRedirect(handler: RedirectHandler, state: string): () => void {
    const previousHandler = this.redirectHandler
    const previousState = this.pendingState
    this.redirectHandler = handler
    this.pendingState = state
    return () => {
      this.redirectHandler = previousHandler
      this.pendingState = previousState
    }
  }

  /**
   * The `state` parameter for the authorization request the SDK is building.
   *
   * Implemented rather than omitted because this client's redirect lands on a
   * loopback listener, which any local process can reach: without an echoed
   * nonce to compare, the listener would redeem whatever `code` the first
   * caller handed it. Outside an attempt there is nothing to authorize and
   * this is never reached.
   * @inheritdoc
   */
  state(): string {
    const state = this.pendingState
    /* v8 ignore next -- the SDK only builds an authorization request from inside an attempt, which always installs one. */
    if (state === undefined) throw new McpReauthorizationRequiredError(this.serverName)
    return state
  }

  /** @inheritdoc */
  get redirectUrl(): string {
    return this.config.redirectUri
  }

  /** @inheritdoc */
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.config.clientName ?? `dsh (${this.serverName})`,
      redirect_uris: [this.config.redirectUri],
      grant_types: GRANT_TYPES,
      response_types: ['code'],
      token_endpoint_auth_method: this.config.clientSecret === undefined ? 'none' : 'client_secret_post',
      ...this.config.scope === undefined ? {} : { scope: this.config.scope },
    }
  }

  /**
   * Configured client credentials win over anything Dynamic Client
   * Registration previously stored. A human who pastes a new client id into
   * Settings expects the next sign-in to use it; preferring the stored pair
   * would silently keep using the old registration until the record is
   * cleared by hand.
   * @inheritdoc
   */
  async clientInformation(_ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    if (this.config.clientId !== undefined) {
      return {
        client_id: this.config.clientId,
        ...this.config.clientSecret === undefined ? {} : { client_secret: this.config.clientSecret },
      }
    }
    return (await this.store.read()).clientInformation
  }

  /** @inheritdoc */
  async saveClientInformation(clientInformation: StoredOAuthClientInformation): Promise<void> {
    await this.store.merge({ clientInformation })
  }

  /** @inheritdoc */
  async tokens(_ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    return (await this.store.read()).tokens
  }

  /**
   * Commit a freshly issued or freshly refreshed token set.
   *
   * This is the write that has to be atomic, and the reason the whole grant
   * lives in one record: the SDK calls this from the refresh path with no
   * coordination of its own, so two processes that both noticed the access
   * token expiring would otherwise race, and a rotating authorization server
   * (one that issues a new refresh token on every refresh) would leave the
   * loser holding a refresh token the server has already retired.
   * @inheritdoc
   */
  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    await this.store.merge({ tokens, obtainedAt: Date.now(), codeVerifier: undefined })
  }

  /** @inheritdoc */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const handler = this.redirectHandler
    if (handler === undefined) throw new McpReauthorizationRequiredError(this.serverName)
    await handler(authorizationUrl)
  }

  /** @inheritdoc */
  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.merge({ codeVerifier })
  }

  /** @inheritdoc */
  async codeVerifier(): Promise<string> {
    const verifier = (await this.store.read()).codeVerifier
    if (verifier === undefined) {
      throw new Error(`mcp-client-oauth(${this.serverName}): no PKCE code verifier is stored for this attempt`)
    }
    return verifier
  }

  /** @inheritdoc */
  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    await this.store.merge({ discoveryState })
  }

  /** @inheritdoc */
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.read()).discoveryState
  }

  /**
   * Drop the credentials a server has told us are no longer valid.
   *
   * `'client'` deliberately keeps a configured `clientId`: that pair came
   * from the human, not from a registration this code can redo, so forgetting
   * it would only turn a recoverable "re-consent" into an unrecoverable
   * "reconfigure". Only a DCR-minted pair is genuinely this package's to
   * discard.
   * @inheritdoc
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    switch (scope) {
      case 'all':
        await this.store.clear()
        return
      case 'client': {
        if (this.config.clientId !== undefined) return
        // A hand-registered pair is the human's, not this code's to discard —
        // see `McpOAuthGrant.clientConfigured`.
        if ((await this.store.read()).clientConfigured === true) return
        await this.store.merge({ clientInformation: undefined })
        return
      }
      case 'tokens':
        await this.store.merge({ tokens: undefined, obtainedAt: undefined })
        return
      case 'verifier':
        await this.store.merge({ codeVerifier: undefined })
        return
      case 'discovery':
        await this.store.merge({ discoveryState: undefined })
    }
  }

  /**
   * Describe the stored authorization for a listing surface.
   * @returns presence, renewability, and timestamps — never a token value.
   */
  status(): ReturnType<McpOAuthStore['status']> {
    return this.store.status()
  }

  /** Forget this connector's stored authorization entirely — the Sign out path. */
  async signOut(): Promise<void> {
    await this.store.clear()
  }
}
