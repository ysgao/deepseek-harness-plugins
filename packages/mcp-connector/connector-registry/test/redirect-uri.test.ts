/**
 * What may be stored as an OAuth connector's `redirectUri`.
 *
 * The field used to take any string. That made one specific slip permanent
 * and self-concealing: the sign-in flow asks a human to paste the callback
 * URL their browser landed on, and pasting it one field over — into the
 * connector's own `redirectUri` — stored a URL with last attempt's `code` and
 * `state` still on it. Every later authorization request then sent that as
 * `redirect_uri`, no authorization server matched it against its
 * registration, and the resulting mismatch error named neither the field at
 * fault nor the paste that set it. The connector simply never signed in
 * again.
 *
 * So the refusal is judged on the way in, by `buildClientConfig`, which `put`
 * runs before the definition can reach the settings document.
 */
import { describe, expect, it } from 'vitest'
import { buildClientConfig, McpConnectorInvalidError } from '../src/registry.ts'
import type { McpConnectorDefinition } from '../src/types.ts'

/** An OAuth connector shaped like the Atlassian remote one this was found on. */
function oauthDefinition(overrides: Partial<McpConnectorDefinition> = {}): McpConnectorDefinition {
  return {
    id: 'atlassiancloud',
    label: 'Atlassian (remote)',
    enabled: true,
    transport: 'streamable-http-oauth',
    url: 'https://mcp.atlassian.com/v1/mcp',
    ...overrides,
  }
}

/** The exact shape that was found stored on a live connector. */
const PASTED_CALLBACK
  = 'http://127.0.0.1:33418/mcp-oauth/callback'
    + '?code=557058-35a958d6-f55d-496f-b2ea-4a68be722de8%3AZWFKPfPn25ZX3rd2'
    + '&state=6c892403-32c7-43e1-a6f5-28d1376047ff'

describe('buildClientConfig redirectUri', () => {
  it('defaults to the loopback callback when the definition names none', () => {
    const config = buildClientConfig(oauthDefinition())
    expect(config.transport).toBe('streamable-http-oauth')
    expect(config.oauth?.redirectUri).toBe('http://127.0.0.1:33418/mcp-oauth/callback')
  })

  it('keeps a redirect URI that is one', () => {
    const config = buildClientConfig(oauthDefinition({ redirectUri: 'https://dsh.example.com/mcp-oauth/callback' }))
    expect(config.oauth?.redirectUri).toBe('https://dsh.example.com/mcp-oauth/callback')
  })

  it('refuses the pasted callback URL that motivated this check', () => {
    expect(() => buildClientConfig(oauthDefinition({ redirectUri: PASTED_CALLBACK })))
      .toThrow(McpConnectorInvalidError)
  })

  it('names the parameters that gave the paste away, and says where a callback URL goes', () => {
    expect(() => buildClientConfig(oauthDefinition({ redirectUri: PASTED_CALLBACK })))
      .toThrow(/code, state/)
    expect(() => buildClientConfig(oauthDefinition({ redirectUri: PASTED_CALLBACK })))
      .toThrow(/sign-in prompt/)
  })

  it('does not echo the authorization code it is refusing', () => {
    // The message reaches a log, a CLI transcript, and the Settings page. The
    // value being refused carries a live code; repeating it would spread it.
    expect(() => buildClientConfig(oauthDefinition({ redirectUri: PASTED_CALLBACK })))
      .not.toThrow(/557058-35a958d6/)
  })

  it('refuses a callback URL that came back as an error rather than a code', () => {
    expect(() => buildClientConfig(oauthDefinition({
      redirectUri: 'http://127.0.0.1:33418/mcp-oauth/callback?error=access_denied',
    }))).toThrow(McpConnectorInvalidError)
  })

  it('refuses a value that is not an absolute URL', () => {
    expect(() => buildClientConfig(oauthDefinition({ redirectUri: '/mcp-oauth/callback' })))
      .toThrow(McpConnectorInvalidError)
  })

  it('refuses a scheme that is not http or https', () => {
    expect(() => buildClientConfig(oauthDefinition({ redirectUri: 'javascript:alert(1)' })))
      .toThrow(McpConnectorInvalidError)
  })

  it('leaves a query string that is not a callback alone', () => {
    // Nothing in OAuth forbids a redirect URI carrying its own parameters; only
    // the ones an authorization server adds on the way back are the tell.
    const config = buildClientConfig(oauthDefinition({
      redirectUri: 'https://dsh.example.com/callback?tenant=snomed',
    }))
    expect(config.oauth?.redirectUri).toBe('https://dsh.example.com/callback?tenant=snomed')
  })

  it('judges nothing on a transport with no authorization', () => {
    const config = buildClientConfig(oauthDefinition({
      transport: 'streamable-http',
      redirectUri: PASTED_CALLBACK,
    }))
    expect(config.transport).toBe('streamable-http')
  })
})
