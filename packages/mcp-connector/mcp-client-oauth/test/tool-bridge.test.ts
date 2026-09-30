/**
 * Regression test for the LM Studio `$defs`-stripping incident: `syncTools`
 * must register a tool whose `inputSchema` has already had every
 * `$ref: "#/$defs/<name>"` inlined by {@link repairDanglingDefsRefs}, not
 * the server's raw schema.
 *
 * Why an integration test, not just a unit test on the repair function
 * itself: {@link ../src/schema-repair.ts} already has thorough unit
 * coverage of the repair logic in isolation, but that suite cannot catch a
 * future edit to {@link ../src/tool-bridge.ts} that stops *calling* it (a
 * dropped `repairDanglingDefsRefs(...)` wrapper around `tool.inputSchema`
 * compiles and type-checks fine — nothing but a runtime check on the
 * registered tool's own `.parameters` would notice). This exercises the
 * real `syncTools` sync path end to end, the same way it runs in
 * production, against the exact schema shape captured live from
 * `sheetsmcp.googleapis.com`'s `update_spreadsheet` tool.
 *
 * Background, in full, on the Docs/Sheets/Slides Conversation of
 * 2026-09-30: Google's remote MCP servers export this tool with a correct,
 * resolvable `$defs.WriteControl` — confirmed by logging the schema at this
 * exact registration point, before anything else touches it. By the time
 * the schema reaches the wire for an `anthropic-messages`-dialect request
 * (built by the third-party `@earendil-works/pi-ai` library, used
 * identically for the real Anthropic route and for any custom
 * OpenAI/Anthropic-compatible route such as a local LM Studio server),
 * `$defs` was gone and the sibling `$ref` survived — confirmed by capturing
 * the literal bytes sent over the wire via a logging proxy in front of a
 * real LM Studio server. Real Anthropic tolerated the resulting dangling
 * reference silently; LM Studio's grammar-compiling engine hard-failed
 * every request offering the tool with `JSON schema error at
 * #/properties/writeControl: cannot resolve $ref #/$defs/WriteControl,
 * $defs not found`. `repairDanglingDefsRefs` closes the gap at the one
 * point in the pipeline this repo owns — tool registration — so no
 * `$ref`/`$defs` pair survives to reach pi-ai (this version or a future
 * one) regardless of what it does with them.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { syncTools } from '../src/tool-bridge.ts'
import type { ToolBridgeOptions } from '../src/tool-bridge.ts'

/** The exact `update_spreadsheet` `inputSchema` captured from a real
 * `sheetsmcp.googleapis.com` `tools/list` response: a resolvable `$ref`
 * into a real, present `$defs.WriteControl`. */
const REAL_SHEETS_UPDATE_SPREADSHEET_SCHEMA = {
  type: 'object',
  properties: {
    requests: {
      description: 'Required. A list of updates to apply to the spreadsheet.',
      items: {
        additionalProperties: { description: 'Properties of the object.' },
        type: 'object',
      },
      type: 'array',
    },
    spreadsheetId: {
      description: 'Required. The ID of the spreadsheet to update.',
      type: 'string',
    },
    writeControl: {
      $ref: '#/$defs/WriteControl',
      description: 'Optional. Provides control over how write requests are executed.',
    },
  },
  required: ['spreadsheetId', 'requests'],
  $defs: {
    WriteControl: {
      type: 'object',
      properties: {
        requiredRevisionId: {
          type: 'string',
          description: 'The revision ID of the spreadsheet that the write request will be applied to.',
        },
      },
    },
  },
}

/** Recursively check that no object in `value` carries a `$ref` or `$defs` key. */
function hasRefOrDefs(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRefOrDefs)
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if ('$ref' in record || '$defs' in record) return true
  return Object.values(record).some(hasRefOrDefs)
}

/** Minimal mock MCP `Client`: one server, one tool, the schema above. */
function mockClientWithSchema(inputSchema: Record<string, unknown>) {
  return {
    listTools: async () => ({ tools: [{ name: 'update_spreadsheet', description: 'x', inputSchema }], nextCursor: undefined }),
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    getServerCapabilities: (): object => ({ tools: {} }),
  }
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

describe('syncTools schema repair (LM Studio $defs regression)', () => {
  it('registers the tool with every $ref/$defs inlined, not the server\'s raw schema', async () => {
    const ctx = await mountRegistry()
    const client = mockClientWithSchema(REAL_SHEETS_UPDATE_SPREADSHEET_SCHEMA)
    const opts: ToolBridgeOptions = { registrationFailure: 'throw', serverName: 'sheets', toolCallTimeoutMs: 60_000 }

    try {
      await syncTools(client as never, ctx, opts, new Map())

      const registered = ctx.tools.get('mcp__sheets__update_spreadsheet')
      expect(registered).toBeDefined()

      // The one invariant LM Studio's engine needs: nothing left to fail to resolve.
      expect(hasRefOrDefs(registered!.parameters)).toBe(false)

      // And the content is still there — inlined, not merely deleted.
      const parameters = registered!.parameters as { properties: { writeControl: unknown } }
      expect(parameters.properties.writeControl).toEqual({
        type: 'object',
        properties: {
          requiredRevisionId: {
            type: 'string',
            description: 'The revision ID of the spreadsheet that the write request will be applied to.',
          },
        },
        description: 'Optional. Provides control over how write requests are executed.',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('still registers a tool with no $ref at all unchanged', async () => {
    const ctx = await mountRegistry()
    const plainSchema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    const client = mockClientWithSchema(plainSchema)
    const opts: ToolBridgeOptions = { registrationFailure: 'throw', serverName: 'sheets', toolCallTimeoutMs: 60_000 }

    try {
      await syncTools(client as never, ctx, opts, new Map())
      const registered = ctx.tools.get('mcp__sheets__update_spreadsheet')
      expect(registered!.parameters).toEqual(plainSchema)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
