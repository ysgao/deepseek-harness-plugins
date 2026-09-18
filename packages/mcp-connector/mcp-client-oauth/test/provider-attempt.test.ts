/**
 * One sign-in attempt asks the human to open exactly one URL, and keeps the
 * PKCE verifier that belongs to it.
 *
 * This is not hypothetical tidiness. A connector whose mount is retrying under
 * a pending sign-in drives `auth()` once per retry — the supervisor
 * reconnects, the server answers 401, the SDK mints a fresh PKCE pair and
 * saves it over the last. Observed against Atlassian's MCP server: six
 * authorization URLs, six `code_challenge` values, one `state`. The human is
 * looking at the first URL the entire time, so the redemption failed with
 * "Invalid PKCE code_verifier" — an error naming the one thing that was never
 * wrong.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { McpOAuthProvider, withRefreshableGrant } from '../src/oauth/provider.ts'
import { McpOAuthStore } from '../src/oauth/store.ts'

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
      },
      deleteRecord: (key: CredentialKey) => {
        records.delete(String(key))
        return Promise.resolve()
      },
    },
  } as unknown as Context
}

/** A provider over a fresh in-memory record, with the URLs it hands the human. */
function subject(): { provider: McpOAuthProvider; store: McpOAuthStore; opened: URL[] } {
  const ctx = fakeCredentialsContext()
  const provider = new McpOAuthProvider(ctx, 'atlassian', {
    redirectUri: 'http://127.0.0.1:33418/mcp-oauth/callback',
  })
  const opened: URL[] = []
  return { provider, store: new McpOAuthStore(ctx, 'atlassian'), opened }
}

/** One round of what the SDK does when it decides authorization is needed. */
async function authorizationRound(
  provider: McpOAuthProvider,
  verifier: string,
  url: string,
): Promise<void> {
  // The SDK's order, from `auth()`: save the verifier, then redirect.
  await provider.saveCodeVerifier(verifier)
  await provider.redirectToAuthorization(new URL(url))
}

describe('one authorization request per attempt', () => {
  it('shows the human one URL however many times the SDK asks', async () => {
    const { provider, opened } = subject()
    const release = provider.withRedirect(url => { opened.push(url) }, 'state-1')
    await authorizationRound(provider, 'verifier-1', 'https://as.example/authorize?challenge=1')
    await authorizationRound(provider, 'verifier-2', 'https://as.example/authorize?challenge=2')
    await authorizationRound(provider, 'verifier-3', 'https://as.example/authorize?challenge=3')
    release()
    expect(opened.map(String)).toEqual(['https://as.example/authorize?challenge=1'])
  })

  it('keeps the verifier belonging to the URL the human was given', async () => {
    const { provider, store, opened } = subject()
    const release = provider.withRedirect(url => { opened.push(url) }, 'state-1')
    await authorizationRound(provider, 'verifier-1', 'https://as.example/authorize?challenge=1')
    await authorizationRound(provider, 'verifier-2', 'https://as.example/authorize?challenge=2')
    release()
    // Storing verifier-2 is what produced "Invalid PKCE code_verifier": the
    // human can only ever open the URL built from verifier-1.
    expect(await provider.codeVerifier()).toBe('verifier-1')
    expect((await store.read()).codeVerifier).toBe('verifier-1')
  })

  it('issues again for a genuinely new attempt', async () => {
    const { provider, opened } = subject()
    const first = provider.withRedirect(url => { opened.push(url) }, 'state-1')
    await authorizationRound(provider, 'verifier-1', 'https://as.example/authorize?challenge=1')
    first()

    // A human who cancelled and clicked Sign in again must get a fresh URL,
    // or the second attempt would silently do nothing.
    const second = provider.withRedirect(url => { opened.push(url) }, 'state-2')
    await authorizationRound(provider, 'verifier-9', 'https://as.example/authorize?challenge=9')
    second()

    expect(opened.map(u => u.searchParams.get('challenge'))).toEqual(['1', '9'])
    expect(await provider.codeVerifier()).toBe('verifier-9')
  })

  it('still refuses to redirect outside an attempt, where nobody is watching', async () => {
    const { provider } = subject()
    await expect(provider.redirectToAuthorization(new URL('https://as.example/authorize')))
      .rejects.toThrow(/atlassian/)
  })

  it('stores a verifier outside an attempt, which the unattended refresh leg needs', async () => {
    const { provider, store } = subject()
    await provider.saveCodeVerifier('unattended')
    expect((await store.read()).codeVerifier).toBe('unattended')
  })
})

describe('withRefreshableGrant', () => {
  it('asks Google for the refresh token it otherwise withholds', () => {
    const url = withRefreshableGrant(new URL('https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=y'))
    expect(url.searchParams.get('access_type')).toBe('offline')
    // Without this Google returns a refresh token only on the very first
    // grant, so re-authorizing after an expiry would not fix the expiry.
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('keeps every parameter the SDK put there', () => {
    const url = withRefreshableGrant(new URL('https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s&scope=y'))
    expect(url.searchParams.get('client_id')).toBe('x')
    expect(url.searchParams.get('state')).toBe('s')
    expect(url.searchParams.get('scope')).toBe('y')
  })

  it('sends nothing non-standard to an authorization server that did not ask for it', () => {
    const original = new URL('https://mcp.atlassian.com/v1/authorize?client_id=x')
    const url = withRefreshableGrant(original)
    expect(url).toBe(original)
    expect(url.searchParams.get('access_type')).toBeNull()
  })

  it('does not edit the URL the SDK still holds', () => {
    const original = new URL('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')
    withRefreshableGrant(original)
    expect(original.searchParams.get('access_type')).toBeNull()
  })
})
