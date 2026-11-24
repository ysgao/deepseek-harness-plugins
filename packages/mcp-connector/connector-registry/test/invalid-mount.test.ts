/**
 * What a surface is told about a connector that cannot be mounted as written.
 *
 * `reconcileOnce` records such a connector as a failed mount carrying the
 * reason, precisely so the CLI and the Settings page can show it next to the
 * connector it belongs to. It used to record it in the wrong place: the sweep
 * that drops every mount the pass does not want ran immediately afterwards,
 * and an invalid definition is by construction not wanted, so the reason was
 * entered into the map and taken back out within the same pass. Every
 * unmountable connector then surfaced as `disabled` with no error at all —
 * the one state that says "you turned this off" about a connector the human
 * had turned on.
 *
 * Checked with a stdio definition missing its command, because the rule is
 * about the reconcile bookkeeping rather than any one transport, and a stdio
 * entry needs no credential store to describe.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { McpConnectorRegistry } from '../src/registry.ts'
import type { McpConnectorDefinition } from '../src/types.ts'

/**
 * A registry standing on a fixed definition list, with no loader behind it.
 *
 * `reconcileOnce` and `config` are reached through index access on purpose:
 * the bookkeeping under test is deliberately private, and the alternative —
 * widening it to be testable — would be changing the thing to suit the test.
 */
function registryOver(definitions: readonly McpConnectorDefinition[]): McpConnectorRegistry {
  const registry = new McpConnectorRegistry(new Context())
  ;(registry as unknown as { config: unknown }).config = { connectors: { get: () => definitions } }
  return registry
}

/** Mount exactly this list, as a settings commit would. */
async function reconcile(registry: McpConnectorRegistry, definitions: readonly McpConnectorDefinition[]): Promise<void> {
  await (registry as unknown as {
    reconcileOnce: (override?: readonly McpConnectorDefinition[]) => Promise<void>
  }).reconcileOnce(definitions)
}

/** An enabled stdio connector that names no command, so it cannot mount. */
const UNMOUNTABLE: McpConnectorDefinition = {
  id: 'unmountable',
  label: 'Unmountable',
  enabled: true,
  transport: 'stdio',
  command: '',
}

/** The same connector, switched off by the human rather than refused. */
const SWITCHED_OFF: McpConnectorDefinition = { ...UNMOUNTABLE, id: 'switchedoff', enabled: false }

describe('a connector that cannot be mounted as written', () => {
  it('survives the sweep that used to delete it, and reports failed', async () => {
    const registry = registryOver([UNMOUNTABLE])
    await reconcile(registry, [UNMOUNTABLE])
    const [entry] = await registry.list()
    expect(entry?.health).toBe('failed')
  })

  it('carries the reason, which is the whole point of recording it', async () => {
    const registry = registryOver([UNMOUNTABLE])
    await reconcile(registry, [UNMOUNTABLE])
    const [entry] = await registry.list()
    expect(entry?.error).toMatch(/names no command/)
  })

  it('is not reported as disabled, which would blame the human', async () => {
    const registry = registryOver([UNMOUNTABLE])
    await reconcile(registry, [UNMOUNTABLE])
    const [entry] = await registry.list()
    expect(entry?.health).not.toBe('disabled')
  })

  it('still reports a genuinely switched-off connector as disabled', async () => {
    const registry = registryOver([SWITCHED_OFF])
    await reconcile(registry, [SWITCHED_OFF])
    const [entry] = await registry.list()
    expect(entry?.health).toBe('disabled')
    expect(entry?.error).toBeUndefined()
  })

  it('keeps reporting the reason across a second pass that changes nothing', async () => {
    // The sweep runs every pass, not only the first; a reason that survived
    // one reconcile and vanished on the next would be worse than never shown.
    const registry = registryOver([UNMOUNTABLE])
    await reconcile(registry, [UNMOUNTABLE])
    await reconcile(registry, [UNMOUNTABLE])
    const [entry] = await registry.list()
    expect(entry?.health).toBe('failed')
    expect(entry?.error).toMatch(/names no command/)
  })

  it('lets it recover once the definition is repaired', async () => {
    const registry = registryOver([UNMOUNTABLE])
    await reconcile(registry, [UNMOUNTABLE])
    expect((await registry.list())[0]?.error).toBeDefined()

    // Repaired to a transport that needs no child and no network to be judged
    // mountable; what matters is that the recorded refusal does not outlive it.
    const repaired: McpConnectorDefinition = {
      id: 'unmountable',
      label: 'Unmountable',
      enabled: false,
      transport: 'stdio',
      command: 'uvx',
    }
    ;(registry as unknown as { config: unknown }).config = { connectors: { get: () => [repaired] } }
    await reconcile(registry, [repaired])
    expect((await registry.list())[0]?.error).toBeUndefined()
  })
})
