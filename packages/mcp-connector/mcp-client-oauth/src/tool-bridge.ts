/**
 * Tool-registry bridge: the public-name derivation and the two-phase
 * generation swap, reimplemented over `@deepseek-ai/dsh-mcp-client`'s own
 * exported {@link createMcpToolDefinition}.
 *
 * Reimplemented rather than forked because the split is lopsided in this
 * package's favour. Everything difficult about bridging an MCP tool onto
 * `ctx.tools` — the canonical result schema, the image-attachment projection,
 * the PTC-mode structured content, the untrusted-content narrowing — lives in
 * `createMcpToolDefinition`, which that package exports from its own package
 * entry as real public surface. What is left is name derivation and the swap,
 * which are short, and which a Host package cannot import anyway: the vendor
 * keeps them in `src/tools.ts`, reachable only through its `./src/*` export,
 * and a `./src/*` import resolves to a raw `.ts` file that plain Node ESM
 * cannot load at runtime. (A browser-bundled Client package inlines such an
 * import, which is why the Settings UI packages in this repo can use that
 * export and a Host package cannot.)
 *
 * Both halves are kept behaviourally identical to the vendor's, including the
 * hash-suffixed lossy-normalization rule, so a server moved from
 * `@deepseek-ai/dsh-mcp-client` to this package keeps the exact model-facing
 * tool names it already had — a name change would silently invalidate every
 * prompt, transcript, and allowlist referring to them.
 *
 * At vendor pin `841f76d3` the swap itself picked up two real changes, both
 * ported here:
 *
 * 1. The bridge now compiles and checks each tool's advertised `outputSchema`
 *    itself (via the SDK's own `AjvJsonSchemaValidator`, from the SDK's own
 *    public `./validators/ajv` export — not a vendor internal), and the
 *    schema is no longer also handed to `client.callTool`'s own
 *    `toolDefinition`, which used to make the SDK re-validate the same thing
 *    and report a failure indistinguishable from a server's own JSON-RPC
 *    error.
 * 2. A registry conflict on this server's `mcp__<serverName>__` namespace
 *    always rejects now (`McpToolRegistrationError`) instead of toggling
 *    between "contain" (silently register zero tools) and "throw" by whether
 *    `failOnStartupError` was set. `connection.ts`'s supervisor is what
 *    decides what a thrown registration failure means for the connection,
 *    uniformly for the initial sync and every later re-sync — see that
 *    file's own doc comment.
 *
 * Not ported: the vendor's new generation-aware session-refusal retry
 * (`McpSessionRefused`/`McpCallRecovery`/`sendAgain`), its on-demand tool
 * loading (`McpToolLoader`), and its credential-template secret redaction
 * (`redact`). All three are wired through vendor-internal modules this
 * package does not fork (`status.ts`, `tool-loading.ts`, `credentials.ts`)
 * and are no part of `ToolBridgeOptions`'s own four fields, so adopting them
 * would mean forking additional vendor files beyond the four this package is
 * recorded against in `scripts/replacement-parity.json`. A call this server
 * refused for its session still fails outright rather than being retried
 * once the reconnect completes — a real, bounded simplification, not a
 * silent drop, since the call failure is reported the same way an ordinary
 * disconnect already was.
 *
 * @module dsh-plugins-mcp-client-oauth/tool-bridge
 */

import { createHash } from 'node:crypto'
import type { Client, JsonSchemaType, Tool } from '@modelcontextprotocol/client'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv'
import type { Context } from '@deepseek-ai/cordis'
import { createMcpToolDefinition, McpLocalError, McpToolError } from '@deepseek-ai/dsh-mcp-client'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { repairDanglingDefsRefs } from './schema-repair.ts'

/** Resolved options relevant to tool bridging. */
export interface ToolBridgeOptions {
  /** The connector's stable local namespace. */
  serverName: string
  /** Timeout per tool call in milliseconds. */
  toolCallTimeoutMs: number
}

/** State for one sync generation: the current set of disposers keyed by public name. */
export type ToolDisposers = Map<string, () => void>

/**
 * Registration failed after the prior generation was removed and partial
 * registrations were rolled back.
 *
 * Mirrors the vendor's own `McpToolRegistrationError` (`tools.ts`, not
 * re-exported from the package entry), built the same way over the
 * importable {@link McpLocalError} so `connection.ts` can distinguish "the
 * server namespace is squatted" from an ordinary transport failure.
 */
export class McpToolRegistrationError extends McpLocalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'MCP_TOOL_REGISTRATION_FAILED', options)
  }
}

/**
 * DeepSeek function-name contract: at most 64 characters. Wire-protocol
 * constant, not configuration.
 */
const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/**
 * Derive the model-facing public name for one MCP tool.
 *
 * Deterministic pure function of `(serverName, rawName)`: the clean case is
 * `mcp__<serverName>__<rawName>` verbatim. When character replacement or
 * truncation to the DeepSeek function-name contract (64 chars,
 * `[A-Za-z0-9_-]`) changes the name, a 12-hex-char SHA-256 hash of the
 * identity is appended so distinct MCP identities never collapse into the
 * same public name.
 *
 * @param serverName - Stable local namespace from plugin config.
 * @param rawName - The MCP server's own tool name.
 * @returns The globally unique, model-facing ToolRuntime name.
 */
export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** A tool's compiled structured-output check, or why its advertised output schema cannot be compiled. */
type OutputCheck = { compileError: string } | {
  /**
   * @param structured - `structuredContent` of a successful result.
   * @returns why the value violates the advertised output schema, or undefined when it conforms.
   */
  check(structured: unknown): string | undefined
}

/** Diagnostic text for a caught value, without pulling in the vendor's own unexported `describeError`. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error)
}

/**
 * Compile one tool's advertised output schema with the validator the SDK uses on Node.
 * @param validators - validator provider shared by one listing.
 * @param tool - listed tool; a tool without `outputSchema` needs no check.
 * @returns the check, a compile failure, or undefined without an output schema.
 */
function compileOutputCheck(validators: AjvJsonSchemaValidator, tool: Tool): OutputCheck | undefined {
  if (tool.outputSchema === undefined) return undefined
  let validate: ReturnType<AjvJsonSchemaValidator['getValidator']>
  try {
    // The listed schema is the wire object the SDK passes to the same provider; only its optional `$schema` typing differs.
    validate = validators.getValidator(tool.outputSchema as JsonSchemaType)
  } catch (error) {
    return { compileError: describeError(error) }
  }
  return {
    check(structured) {
      if (structured === undefined) return 'the tool has an output schema but returned no structured content'
      try {
        const result = validate(structured)
        return result.valid ? undefined : `structured content does not match the output schema: ${result.errorMessage}`
      } catch (error) {
        return `structured content could not be validated: ${describeError(error)}`
      }
    },
  }
}

/**
 * Sync the MCP server's tool list into the harness ToolRuntime.
 *
 * Two phases keep the swap safe:
 *
 * 1. Fetch: let the SDK aggregate `tools/list` and build the full next
 *    generation of `ToolDefinition`s under public names. Any failure here
 *    (network error or duplicate raw name) rejects and leaves the previous
 *    generation registered untouched.
 * 2. Swap: dispose the previous generation, register the new one. A registry
 *    conflict here can only mean a foreign registration squats on this
 *    server's `mcp__<serverName>__` namespace — the partial generation is
 *    rolled back (zero tools from this server), logged, and rejected with
 *    {@link McpToolRegistrationError} so the supervisor closes the failed
 *    connection generation, for the initial sync and every later re-sync
 *    alike.
 *
 * @param client - Connected MCP Client instance used to list and call tools.
 * @param ctx - Cordis context providing the `tools` service for registration.
 * @param opts - Bridge options: server namespace and per-call timeout.
 * @param previous - Disposer map from the prior sync generation; disposed
 *   during the swap phase (only after the fetch phase succeeded).
 * @returns A map of registered public tool names to their unregister
 *   disposers — the exact set of live registrations owned by this server.
 */
export async function syncTools(
  client: Client,
  ctx: Context,
  opts: ToolBridgeOptions,
  previous: ToolDisposers,
): Promise<ToolDisposers> {
  // Phase 1: fetch and build the next generation without touching the registry.
  const definitions = new Map<string, ToolDefinition>()
  const response = client.getServerCapabilities()?.tools === undefined
    ? { tools: [] }
    : await client.listTools(undefined, { cacheMode: 'refresh' })
  const outputValidators = new AjvJsonSchemaValidator()
  for (const tool of response.tools) {
    const name = publicToolName(opts.serverName, tool.name)
    if (definitions.has(name)) {
      throw new Error(
        `mcp-client-oauth(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`,
      )
    }
    // The bridge checks structured output itself: the SDK reports its local check as a
    // ProtocolError indistinguishable from a server's own JSON-RPC error, so the schema is
    // withheld from the SDK's own `toolDefinition` and checked here instead.
    const { outputSchema: _outputSchema, ...callDefinition } = tool
    const outputCheck = compileOutputCheck(outputValidators, tool)
    definitions.set(name, createMcpToolDefinition(ctx, {
      name,
      rawName: tool.name,
      description: tool.description ?? '',
      inputSchema: repairDanglingDefsRefs(tool.inputSchema),
      outputSchema: tool.outputSchema,
      taskRequired: tool.execution?.taskSupport === 'required',
      call: async (args, execution: ToolExecution) => {
        if (outputCheck !== undefined && 'compileError' in outputCheck) {
          throw new McpToolError(
            `Tool "${tool.name}" returned an invalid MCP result: its output schema cannot be compiled: ${outputCheck.compileError}`,
            'MCP_INVALID_RESULT',
          )
        }
        const result = await client.callTool(
          { name: tool.name, arguments: args },
          { signal: execution.signal, timeout: opts.toolCallTimeoutMs, toolDefinition: callDefinition },
        )
        if (result.isError === true) return result
        const failure = outputCheck === undefined ? undefined : outputCheck.check(result.structuredContent)
        if (failure !== undefined) {
          throw new McpToolError(`Tool "${tool.name}" returned an invalid MCP result: ${failure}`, 'MCP_INVALID_RESULT')
        }
        return result
      },
    }))
  }

  // Phase 2: swap generations.
  for (const dispose of previous.values()) dispose()
  const disposers: ToolDisposers = new Map()
  try {
    for (const [name, definition] of definitions) {
      disposers.set(name, ctx.tools.register(definition))
    }
  } catch (error) {
    // A conflict on an `mcp__<serverName>__`-qualified name means a foreign
    // registration occupies this server's namespace. Roll back so the model
    // sees either the full generation or none of it — never a partial set.
    for (const dispose of disposers.values()) dispose()
    ctx.logger.error(
      `mcp-client-oauth(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`,
    )
    throw new McpToolRegistrationError('MCP tool registration failed', { cause: error })
  }
  return disposers
}
