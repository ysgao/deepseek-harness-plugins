/**
 * How a stdio connector's secrets reach its child process without passing
 * through the settings document.
 *
 * The rule under test is easy to break quietly in either direction: a
 * resolver that silently skipped an unset reference would spawn the server
 * unauthenticated and turn a missing credential into a pile of 401s from a
 * tool call much later, and a `buildClientConfig` that ever folded a resolved
 * value into its result would put that value into the mount signature — which
 * is compared, retained, and read by a human debugging a reconcile.
 */
import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { buildClientConfig, McpConnectorInvalidError, resolveEnvFrom } from '../src/registry.ts'
import type { McpConnectorDefinition } from '../src/types.ts'

/** A stdio connector shaped like the Atlassian one this field was added for. */
function stdioDefinition(overrides: Partial<McpConnectorDefinition> = {}): McpConnectorDefinition {
  return {
    id: 'atlassian',
    label: 'Atlassian',
    enabled: true,
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-atlassian'],
    env: { JIRA_URL: 'https://example.atlassian.net' },
    envFrom: { JIRA_API_TOKEN: 'ATLASSIAN_API_TOKEN' },
    ...overrides,
  }
}

/** A credential seam holding exactly the references given. */
function reader(values: Record<string, string>): (ref: CredentialRef) => Promise<string | undefined> {
  return ref => Promise.resolve(values[String(ref)])
}

describe('resolveEnvFrom', () => {
  it('resolves each variable to the value of the credential it names', async () => {
    const resolved = await resolveEnvFrom(
      'atlassian',
      { JIRA_API_TOKEN: 'ATLASSIAN_API_TOKEN', CONFLUENCE_API_TOKEN: 'ATLASSIAN_API_TOKEN' },
      reader({ ATLASSIAN_API_TOKEN: 's3cret' }),
    )
    expect(resolved).toEqual({ JIRA_API_TOKEN: 's3cret', CONFLUENCE_API_TOKEN: 's3cret' })
  })

  it('fails the mount rather than spawning a server without its credential', async () => {
    await expect(resolveEnvFrom(
      'atlassian',
      { JIRA_API_TOKEN: 'ATLASSIAN_API_TOKEN' },
      reader({}),
    )).rejects.toBeInstanceOf(McpConnectorInvalidError)
  })

  it('treats an empty stored value as unset', async () => {
    await expect(resolveEnvFrom(
      'atlassian',
      { JIRA_API_TOKEN: 'ATLASSIAN_API_TOKEN' },
      reader({ ATLASSIAN_API_TOKEN: '' }),
    )).rejects.toThrow(/ATLASSIAN_API_TOKEN/)
  })

  it('names every missing reference at once, not just the first', async () => {
    await expect(resolveEnvFrom(
      'atlassian',
      { JIRA_API_TOKEN: 'JIRA_TOKEN', CONFLUENCE_API_TOKEN: 'CONFLUENCE_TOKEN' },
      reader({}),
    )).rejects.toThrow(/JIRA_TOKEN.*CONFLUENCE_TOKEN/s)
  })

  it('reads a name outside the reference grammar as unset instead of throwing a TypeError', async () => {
    // A definition stored before this field was validated can carry anything.
    await expect(resolveEnvFrom(
      'atlassian',
      { JIRA_API_TOKEN: 'not a ref' },
      () => { throw new Error('the seam must not be asked about an impossible name') },
    )).rejects.toBeInstanceOf(McpConnectorInvalidError)
  })

  it('resolves nothing when the connector maps nothing', async () => {
    expect(await resolveEnvFrom('atlassian', {}, reader({}))).toEqual({})
  })
})

describe('buildClientConfig with envFrom', () => {
  it('keeps every resolved value out of the config it returns', () => {
    const config = buildClientConfig(stdioDefinition())
    expect(config).toMatchObject({ transport: 'stdio', env: { JIRA_URL: 'https://example.atlassian.net' } })
    expect(JSON.stringify(config)).not.toContain('ATLASSIAN_API_TOKEN')
  })

  it('refuses a mapping whose key could not be an environment variable', () => {
    expect(() => buildClientConfig(stdioDefinition({ envFrom: { 'not a var': 'ATLASSIAN_API_TOKEN' } })))
      .toThrow(McpConnectorInvalidError)
  })

  it('refuses a mapping that points at something no credential could be called', () => {
    expect(() => buildClientConfig(stdioDefinition({ envFrom: { JIRA_API_TOKEN: 'lower case' } })))
      .toThrow(McpConnectorInvalidError)
  })

  it('accepts a stdio connector that maps nothing', () => {
    expect(() => buildClientConfig(stdioDefinition({ envFrom: undefined }))).not.toThrow()
  })

  it('ignores the mapping on a transport that spawns no child', () => {
    const config = buildClientConfig({
      id: 'remote',
      label: '',
      enabled: true,
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      envFrom: { ANYTHING: 'AT ALL' },
    })
    expect(config.transport).toBe('streamable-http')
  })
})

describe('credentialRef', () => {
  it('accepts the reference name this feature tells people to use', () => {
    expect(String(credentialRef('ATLASSIAN_API_TOKEN'))).toBe('ATLASSIAN_API_TOKEN')
  })
})
