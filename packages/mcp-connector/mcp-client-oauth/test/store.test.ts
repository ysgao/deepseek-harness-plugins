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
import { grantedScopes, McpOAuthStore, portableGrant } from '../src/oauth/store.ts'
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
