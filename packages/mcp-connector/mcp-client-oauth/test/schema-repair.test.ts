/**
 * `repairDanglingDefsRefs` against the exact shapes observed live from
 * Google Workspace's remote MCP servers (`sheetsmcp.googleapis.com`'s
 * `update_spreadsheet` tool) — see the module doc for the full incident:
 * the schema is fine (has a real `$defs.WriteControl`) at the point this
 * repo registers it from `tools/list`, but by the time it reaches the wire
 * for an `anthropic-messages`-dialect request, `$defs` is gone and the
 * sibling `$ref` survives. This function inlines every `$ref` up front so
 * nothing downstream has a `$ref`/`$defs` pair left to lose track of.
 */
import { describe, expect, it } from 'vitest'
import { repairDanglingDefsRefs } from '../src/schema-repair.ts'

describe('repairDanglingDefsRefs', () => {
  it('inlines a $ref whose $defs target is present, keeping the $ref site\'s own siblings', () => {
    const schema = {
      type: 'object',
      properties: {
        spreadsheetId: { type: 'string', description: 'Required.' },
        writeControl: {
          $ref: '#/$defs/WriteControl',
          description: 'Optional. Provides control over how write requests are executed.',
        },
      },
      required: ['spreadsheetId'],
      $defs: {
        WriteControl: {
          type: 'object',
          properties: { requiredRevisionId: { type: 'string' } },
        },
      },
    }

    expect(repairDanglingDefsRefs(schema)).toEqual({
      type: 'object',
      properties: {
        spreadsheetId: { type: 'string', description: 'Required.' },
        writeControl: {
          type: 'object',
          properties: { requiredRevisionId: { type: 'string' } },
          description: 'Optional. Provides control over how write requests are executed.',
        },
      },
      required: ['spreadsheetId'],
    })
    // The fix must not mutate the MCP server's original response in place.
    expect(schema.properties.writeControl).toHaveProperty('$ref')
    expect(schema).toHaveProperty('$defs')
  })

  it('drops a $ref whose #/$defs/<name> target is entirely absent, keeping siblings', () => {
    const schema = {
      type: 'object',
      properties: {
        writeControl: {
          $ref: '#/$defs/WriteControl',
          description: 'Optional. Provides control over how write requests are executed.',
        },
      },
      // No $defs at all.
    }

    expect(repairDanglingDefsRefs(schema)).toEqual({
      type: 'object',
      properties: {
        writeControl: {
          description: 'Optional. Provides control over how write requests are executed.',
        },
      },
    })
  })

  it('drops a $ref whose #/$defs dict exists but is missing that one name', () => {
    const schema = {
      type: 'object',
      properties: {
        writeControl: { $ref: '#/$defs/WriteControl' },
      },
      $defs: { SomeOtherType: { type: 'string' } },
    }

    expect(repairDanglingDefsRefs(schema)).toEqual({
      type: 'object',
      properties: { writeControl: {} },
    })
  })

  it('inlines a $ref nested inside an array items schema', () => {
    const schema = {
      type: 'object',
      properties: {
        requests: {
          type: 'array',
          items: { $ref: '#/$defs/Request', description: 'One update.' },
        },
      },
      $defs: {
        Request: { type: 'object', properties: { op: { type: 'string' } } },
      },
    }

    expect(repairDanglingDefsRefs(schema)).toEqual({
      type: 'object',
      properties: {
        requests: {
          type: 'array',
          items: {
            type: 'object',
            properties: { op: { type: 'string' } },
            description: 'One update.',
          },
        },
      },
    })
  })

  it('inlines a $defs entry that itself $refs a second $defs entry', () => {
    const schema = {
      type: 'object',
      properties: {
        writeControl: { $ref: '#/$defs/WriteControl' },
      },
      $defs: {
        WriteControl: {
          type: 'object',
          properties: { audience: { $ref: '#/$defs/Audience' } },
        },
        Audience: { type: 'string', enum: ['internal', 'external'] },
      },
    }

    expect(repairDanglingDefsRefs(schema)).toEqual({
      type: 'object',
      properties: {
        writeControl: {
          type: 'object',
          properties: {
            audience: { type: 'string', enum: ['internal', 'external'] },
          },
        },
      },
    })
  })

  it('breaks a self-referencing $defs cycle instead of recursing forever', () => {
    const schema = {
      type: 'object',
      properties: {
        node: { $ref: '#/$defs/Node', description: 'A tree node.' },
      },
      $defs: {
        Node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/Node' } },
        },
      },
    }

    const result = repairDanglingDefsRefs(schema) as { properties: { node: { properties: { child: unknown } } } }
    // The cycle point degrades to its sibling annotations rather than
    // looping forever; what matters here is that this call returns at all.
    expect(result.properties.node.properties.child).toEqual({})
  })

  it('leaves a $ref outside the #/$defs/<name> shape alone', () => {
    const schema = {
      type: 'object',
      properties: {
        external: { $ref: 'https://example.com/schemas/thing.json' },
      },
    }

    expect(repairDanglingDefsRefs(schema)).toEqual(schema)
  })

  it('passes non-object input through unchanged', () => {
    expect(repairDanglingDefsRefs(undefined)).toBeUndefined()
    expect(repairDanglingDefsRefs(null)).toBeNull()
    const arr = [1, 2, 3]
    expect(repairDanglingDefsRefs(arr)).toEqual(arr)
  })
})
