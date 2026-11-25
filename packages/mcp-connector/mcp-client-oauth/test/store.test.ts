/**
 * What may and may not travel when one connector's grant is copied onto
 * another — the data half of `McpConnectorRegistry.cloneAuthorization`, which
 * is what lets one Google consent cover Gmail, Drive and Calendar instead of
 * three.
 *
 * The registry's own refusals (unknown id, self-copy, unsigned source, a
 * target that would lose a grant, uncovered scopes) are exercised against the
 * real CLI; what needs a test is the copy itself, because dropping the wrong
 * field is silent — a copied `discoveryState` would point the target's
 * provider at another server's metadata and nothing would say so.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { grantedScopes, McpOAuthStore, portableGrant, pruneUndefined } from '../src/oauth/store.ts'
import type { McpOAuthGrant } from '../src/oauth/types.ts'

/** An in-memory stand-in for the credential seam's record space. */
function fakeCredentialsContext(): Context {
  const records = new Map<string, CredentialRecord>()
  return {
    credentials: {
      readRecord: (key: CredentialKey) => Promise.resolve(records.get(String(key))),
      async modifyRecord(
        key: CredentialKey,
        mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
      ) {
        const next = await mutate(records.get(String(key)))
        if (next !== undefined) records.set(String(key), next)
        return next
      },
      deleteRecord: (key: CredentialKey) => {
        records.delete(String(key))
        return Promise.resolve()
      },
    },
  } as unknown as Context
}

/** A grant as it stands after a real sign-in, every field populated. */
const signedIn: McpOAuthGrant = {
  version: 1,
  tokens: {
    access_token: 'access-token-value',
    refresh_token: 'refresh-token-value',
    token_type: 'Bearer',
    expires_in: 3599,
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly',
  },
  clientInformation: { client_id: 'client-id-value', client_secret: 'client-secret-value' },
  clientConfigured: true,
  codeVerifier: 'verifier-from-the-attempt-that-just-finished',
  discoveryState: { resourceMetadata: { resource: 'https://gmailmcp.googleapis.com/mcp/v1' } },
  obtainedAt: 1_700_000_000_000,
} as McpOAuthGrant

describe('portableGrant', () => {
  it('carries the tokens and the client pair that refreshes them', () => {
    expect(portableGrant(signedIn)).toMatchObject({
      tokens: signedIn.tokens,
      clientInformation: signedIn.clientInformation,
      clientConfigured: true,
      obtainedAt: 1_700_000_000_000,
    })
  })

  it('leaves the source attempt and its cached discovery behind', () => {
    const copy = portableGrant(signedIn)
    expect(copy).not.toHaveProperty('codeVerifier')
    expect(copy).not.toHaveProperty('discoveryState')
  })

  it('copies nothing out of a grant that was never signed in', () => {
    expect(portableGrant({ version: 1 })).toEqual({})
  })
})

describe('grantedScopes', () => {
  it('splits the scope string the server returned', () => {
    expect(grantedScopes(signedIn)).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ])
  })

  it('reads a server that named no scopes as unknown, not as none', () => {
    expect(grantedScopes({ version: 1 })).toBeUndefined()
    expect(grantedScopes({ version: 1, tokens: { access_token: 'a', scope: '  ' } } as McpOAuthGrant)).toBeUndefined()
  })
})

describe('copying a grant between two connectors', () => {
  it('leaves the target authorized with the same tokens and client', async () => {
    const ctx = fakeCredentialsContext()
    const source = new McpOAuthStore(ctx, 'gmail')
    const target = new McpOAuthStore(ctx, 'drive')
    await source.merge(signedIn)

    await target.merge(portableGrant(await source.read()))

    const copied = await target.read()
    expect(copied.tokens).toEqual(signedIn.tokens)
    expect(copied.clientInformation).toEqual(signedIn.clientInformation)
    expect(copied.codeVerifier).toBeUndefined()
    expect(copied.discoveryState).toBeUndefined()
    expect((await target.status()).authorized).toBe(true)
    expect((await target.status()).renewable).toBe(true)
  })

  it('does not disturb the source', async () => {
    const ctx = fakeCredentialsContext()
    const source = new McpOAuthStore(ctx, 'gmail')
    await source.merge(signedIn)

    await new McpOAuthStore(ctx, 'calendar').merge(portableGrant(await source.read()))

    expect(await source.read()).toEqual(signedIn)
  })

  it('writes each connector to its own credential key', () => {
    const ctx = fakeCredentialsContext()
    expect(String(new McpOAuthStore(ctx, 'gmail').key)).toBe('mcp-connector/gmail')
    expect(String(new McpOAuthStore(ctx, 'drive').key)).toBe('mcp-connector/drive')
  })
})

describe('pruneUndefined', () => {
  it('drops a nested undefined, which is what the credential seam refuses', () => {
    // The shape `auth()` hands `saveDiscoveryState` for a server with no RFC
    // 9728 metadata: both keys present, both undefined.
    const state = {
      discoveryState: {
        authorizationServerUrl: 'https://mcp.atlassian.com',
        resourceMetadataUrl: undefined,
        resourceMetadata: undefined,
        authorizationServerMetadata: { issuer: 'https://mcp.atlassian.com' },
      },
    }
    expect(pruneUndefined(state)).toEqual({
      discoveryState: {
        authorizationServerUrl: 'https://mcp.atlassian.com',
        authorizationServerMetadata: { issuer: 'https://mcp.atlassian.com' },
      },
    })
  })

  it('keeps null, false, 0 and the empty string, which are values and not absence', () => {
    expect(pruneUndefined({ a: null, b: false, c: 0, d: '' })).toEqual({ a: null, b: false, c: 0, d: '' })
  })

  it('leaves what the seam should still refuse, so a real mistake is not laundered', () => {
    const date = new Date(0)
    expect(pruneUndefined({ at: date }).at).toBe(date)
  })

  it('does not edit the object it was given, which the SDK still holds', () => {
    const original: { keep: string; drop?: string } = { keep: 'yes', drop: undefined }
    pruneUndefined(original)
    expect('drop' in original).toBe(true)
  })

  it('prunes inside arrays as well as objects', () => {
    expect(pruneUndefined({ list: [{ a: 1, b: undefined }] })).toEqual({ list: [{ a: 1 }] })
  })
})

describe('signing out keeps the client', () => {
  it('forgets the tokens and keeps a hand-registered client pair', async () => {
    const store = new McpOAuthStore(fakeCredentialsContext(), 'gmail')
    await store.setConfiguredClient('client-id', 'client-secret')
    await store.merge({ tokens: { access_token: 'a', token_type: 'Bearer' }, obtainedAt: 1, codeVerifier: 'v' })

    await store.forgetGrant()

    const after = await store.read()
    expect(after.tokens).toBeUndefined()
    expect(after.obtainedAt).toBeUndefined()
    expect(after.codeVerifier).toBeUndefined()
    // Nothing can recreate this pair, and Google's authorization server offers
    // no dynamic registration to fall back on — so losing it here would leave
    // a connector that cannot be signed back in at all.
    expect(after.clientInformation?.client_id).toBe('client-id')
    expect(after.clientConfigured).toBe(true)
  })

  it('drops a client that Dynamic Client Registration minted, and the cached discovery', async () => {
    const store = new McpOAuthStore(fakeCredentialsContext(), 'atlassian')
    // What a DCR sign-in leaves behind: a client the server issued, no
    // `clientConfigured`, and the discovery it was registered through.
    await store.merge({
      clientInformation: { client_id: 'Ram1Dx0W2MAbSAgA', client_id_issued_at: 1_789_740_687 },
      discoveryState: { authorizationServerUrl: 'https://mcp.atlassian.com/' },
      discoveredFor: 'https://mcp.atlassian.com/v1/mcp',
      tokens: { access_token: 'a', refresh_token: 'r', token_type: 'Bearer' },
      obtainedAt: 1,
    })

    await store.forgetGrant()

    const after = await store.read()
    expect(after.tokens).toBeUndefined()
    // Atlassian's own instruction for a server that moved: "clear cached
    // clientIds or .well-known credentials". A sign-out that kept them would
    // sign back in through the old authorization server, as before.
    expect(after.clientInformation).toBeUndefined()
    expect(after.discoveryState).toBeUndefined()
    expect(after.discoveredFor).toBeUndefined()
  })

  it('still removes everything when the whole record goes', async () => {
    const ctx = fakeCredentialsContext()
    const store = new McpOAuthStore(ctx, 'gmail')
    await store.setConfiguredClient('client-id', 'client-secret')
    await store.clear()
    expect((await store.read()).clientInformation).toBeUndefined()
  })
})

describe('status() of tokens stamped by a server the client no longer is', () => {
  it('reports authorized while both stamps agree', async () => {
    const store = new McpOAuthStore(fakeCredentialsContext(), 'atlassian')
    await store.merge({
      clientInformation: { client_id: 'c', issuer: 'https://auth.atlassian.com/tenant' },
      tokens: { access_token: 'a', refresh_token: 'r', token_type: 'Bearer', issuer: 'https://auth.atlassian.com/tenant' },
      obtainedAt: 1,
    })
    expect((await store.status()).authorized).toBe(true)
  })

  it('reports unauthorized once the client re-registers under a server the tokens were never issued by', async () => {
    const store = new McpOAuthStore(fakeCredentialsContext(), 'atlassian')
    // The record a connector edited from v1 to v2 leaves behind after its
    // first post-edit mount attempt: `auth()` re-registered the client against
    // the newly-discovered v2 issuer (see the `discoveryState`/`discoveredFor`
    // tests), but the v1 tokens it found alongside that client are still
    // exactly what it discarded in memory before doing so — nothing ever
    // calls `saveTokens(undefined)` to make that discard durable.
    await store.merge({
      clientInformation: { client_id: 'new-v2-client', issuer: 'https://auth.atlassian.com/tenant' },
      tokens: { access_token: 'stale-v1', refresh_token: 'stale-v1-refresh', token_type: 'Bearer', issuer: 'https://mcp.atlassian.com' },
      obtainedAt: 1,
    })
    const status = await store.status()
    // Not renewed from here either: a token the SDK itself already treats as
    // unusable is not what "renews automatically" should promise a surface.
    expect(status.authorized).toBe(false)
    expect(status.renewable).toBe(false)
    // The client id is still worth showing — a human looking at "not signed
    // in, but a client is configured" is exactly the state that is true.
    expect(status.clientConfigured).toBe(true)
  })

  it('does not second-guess a grant from before either stamp existed', async () => {
    const store = new McpOAuthStore(fakeCredentialsContext(), 'atlassian')
    await store.merge({
      clientInformation: { client_id: 'c' },
      tokens: { access_token: 'a', refresh_token: 'r', token_type: 'Bearer' },
      obtainedAt: 1,
    })
    expect((await store.status()).authorized).toBe(true)
  })
})
