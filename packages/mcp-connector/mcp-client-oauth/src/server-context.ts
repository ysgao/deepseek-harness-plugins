/**
 * Publish connection-owned MCP resources and literal server instructions.
 *
 * Behaviourally identical to `@deepseek-ai/dsh-mcp-client`'s own
 * `src/server-context.ts` (vendor pin `841f76d3`), reimplemented for the same
 * reason {@link module:dsh-plugins-mcp-client-oauth/tool-bridge} is: the
 * vendor keeps it behind its `./src/*` export, which a Host package cannot
 * load at runtime. Both optional consumers are reached through a nested
 * `ctx.inject`, so a composition with neither `mcpResources` nor
 * `systemPrompt` mounted still bridges the server's tools.
 *
 * `replacement`/`retirement` on the `systemPrompt.section()` call are new at
 * this pin: a connection that loses its instructions (a reconnect whose new
 * generation's server sent none, or final disposal) now leaves an explicit
 * supersession notice instead of the section silently reading as empty text.
 *
 * @module dsh-plugins-mcp-client-oauth/server-context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { McpResourceProvider } from '@deepseek-ai/dsh-mcp-resources'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Connection-owned values used by the resource and prompt consumers. */
export interface ServerContext {
  /** Resource access through the current connection generation. */
  resources: McpResourceProvider
  /**
   * Read the last successfully connected server's attributed instructions.
   * @returns literal prompt text, or an empty string when no server instructions are active.
   */
  instructions(): string
}

/**
 * Contribute server context to the services enabled by this composition.
 * @param ctx - server plugin's registration scope and effect owner.
 * @param server - configured server identity.
 * @param connection - live resource operations and successful instruction snapshot.
 */
export function registerServerContext(ctx: Context, server: string, connection: ServerContext): void {
  ctx.inject(['mcpResources'], (inner) => {
    inner.mcpResources.register(server, connection.resources)
  })
  ctx.inject(['systemPrompt'], (inner) => {
    // A connection without instructions yields empty text, so the replacement notice also has to read correctly alone.
    const superseded = `The earlier instructions supplied by MCP server ${JSON.stringify(server)} no longer apply.`
    inner.systemPrompt.section({
      name: `mcp:${server}`,
      order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
      interpolate: false,
      text: () => connection.instructions(),
      replacement: superseded,
      retirement: superseded,
    })
  })
}
