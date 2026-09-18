/**
 * Durable MCP connector registry: owns the `mcp-connector` settings section,
 * mounts one `dsh-plugins-mcp-client-oauth` instance per enabled connector,
 * and publishes `ctx.mcpConnectors` for the RPC controller and the CLI.
 *
 * Mounting from settings rather than from `cordis.yml` is what makes a
 * connector addable at runtime. A `cordis.yml` row is fixed at composition
 * time, which is right for a server that is part of the product and wrong for
 * one a human — or an agent running the CLI — adds to a session already under
 * way. Both remain available: this package does not replace the `cordis.yml`
 * path, it adds a second one beside it, and a profile can use either or both.
 *
 * @module dsh-plugins-mcp-connector-registry
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { McpConnectorRegistry } from './registry.ts'
import type { McpConnectorSection } from './registry.ts'
import type { McpConnectorDefinition } from './types.ts'
// Side-effect type import: declaration-merges `ctx.settings` onto Context.
import type {} from '@deepseek-ai/dsh-settings'

export {
  McpConnectorRegistry, McpConnectorInvalidError, McpConnectorNotFoundError, buildClientConfig, resolveEnvFrom,
} from './registry.ts'
export type { McpConnectorSection } from './registry.ts'
export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-connector-registry'

/**
 * Services required by this plugin.
 *
 * `tools` is deliberately absent even though a mounted connector needs it:
 * the connector *list* is meaningful without one, which is what lets the CLI
 * run this registry in a profile that composes no agent at all. A mounted
 * `dsh-plugins-mcp-client-oauth` instance declares `tools` for itself and
 * stays pending — harmlessly, as a nested fiber rather than a top-level
 * entry — in a composition that has none.
 */
export const inject = ['settings', 'credentials']

/** The settings namespace this plugin owns. */
export const SETTINGS_NAMESPACE = 'mcp-connector'

const Definition: z<McpConnectorDefinition> = z.object({
  id: z.string().required(),
  label: z.string().default(''),
  enabled: z.boolean().default(true),
  transport: z.union([
    z.const('stdio'),
    z.const('streamable-http'),
    z.const('streamable-http-oauth'),
  ]).default('streamable-http-oauth'),
  command: z.string(),
  args: z.array(String).default([]),
  env: z.dict(String).default({}),
  envFrom: z.dict(String).default({}),
  cwd: z.string(),
  url: z.string(),
  headers: z.dict(String).default({}),
  redirectUri: z.string(),
  scope: z.string(),
  toolCallTimeoutMs: z.number(),
  failOnStartupError: z.boolean(),
}) as unknown as z<McpConnectorDefinition>

/**
 * The stored section.
 *
 * Nothing here is a secret, deliberately: the OAuth client pair and the
 * tokens both live in the credential seam's record space instead, and a stdio
 * server's API token is named by `envFrom` rather than written by `env`, so
 * this document stays safe to read, print, diff, and copy.
 */
export const Config: z<McpConnectorSection> = z.object({
  connectors: z.array(Definition).default([]),
}) as unknown as z<McpConnectorSection>

/**
 * Register the settings section, publish `ctx.mcpConnectors`, and mount every
 * enabled connector.
 *
 * Explicitly `async`: Cordis treats a prototype-bearing ordinary function as a
 * constructor, whose returned Promise would not be awaited as startup work.
 * Awaiting the first reconcile here means a composition observes a connector's
 * tools as soon as this entry activates, the same guarantee
 * `@deepseek-ai/dsh-mcp-client` gives a `cordis.yml`-mounted server.
 *
 * @param ctx - host context carrying `ctx.settings` and `ctx.credentials`.
 * @param config - composition-layer connectors, resolved below the user layer.
 * @returns startup readiness once every enabled connector has been mounted.
 */
export async function apply(ctx: Context, config: McpConnectorSection): Promise<void> {
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, Config, { base: config, applies: 'live' })
  // Constructing the Service is what publishes `ctx.mcpConnectors`: Cordis's
  // own `Service` constructor calls `ctx.reflect.provide`, and unregisters it
  // with this fiber. No separate `ctx.set` — that would be a second provision
  // of the same name and Cordis refuses those.
  const registry = new McpConnectorRegistry(ctx)
  await registry.start(scope)
}
