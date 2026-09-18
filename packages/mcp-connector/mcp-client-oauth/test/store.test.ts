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

  it('still removes everything when the whole record goes', async () => {
    const ctx = fakeCredentialsContext()
    const store = new McpOAuthStore(ctx, 'gmail')
    await store.setConfiguredClient('client-id', 'client-secret')
    await store.clear()
    expect((await store.read()).clientInformation).toBeUndefined()
  })
})
