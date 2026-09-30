/**
 * Fully inlines every in-document `$ref: "#/$defs/<name>"` in an MCP tool's
 * `inputSchema`, dropping `$defs` once nothing references it anymore.
 *
 * Root cause this works around: Google Workspace's remote MCP servers
 * (`docsmcp`/`sheetsmcp`/`slidesmcp.googleapis.com`) correctly export a
 * `$defs` dictionary alongside the `$ref`s that use it — confirmed live, by
 * logging the schema at the exact point this repo registers it from
 * `tools/list`, *before* anything else touches it. But by the time the same
 * schema reaches the wire as part of an `anthropic-messages`-dialect request
 * (built by the third-party `@earendil-works/pi-ai` library this repo
 * depends on, used identically for the real Anthropic route and for any
 * custom OpenAI/Anthropic-compatible route such as a local LM Studio
 * server), `$defs` is gone and the sibling `$ref` that needed it survives —
 * confirmed by capturing the literal bytes sent over the wire via a logging
 * proxy in front of a real LM Studio server. Anthropic's own API tolerates
 * the resulting dangling reference silently (it does not pre-resolve tool
 * schemas into a constrained-decoding grammar, so an unresolved *optional*
 * `$ref` is simply never populated). An engine that does compile tool
 * schemas into a grammar up front — observed with LM Studio's local
 * server — hard-fails the entire request the moment it meets one: `JSON
 * schema error at #/properties/writeControl: cannot resolve $ref
 * #/$defs/WriteControl, $defs not found`.
 *
 * Rather than chase the exact line inside a third-party dependency that
 * drops `$defs`, this closes the gap at the one point in the pipeline this
 * repo actually owns: resolve every such `$ref` against the schema's own
 * `$defs` *before* the schema is ever registered as a tool, so nothing
 * downstream — this pi-ai version today, a future one, or any other
 * consumer — has a `$ref`/`$defs` pair left to mishandle. A `$ref` whose
 * target is legitimately missing (a different, narrower defect than the one
 * above) degrades the same way: its non-`$ref` sibling keys (typically just
 * `description`) survive and `$ref` alone is dropped, which is schema-valid —
 * an object with no constraint keywords accepts any JSON value, so the
 * parameter stays present and documented, just unvalidated, matching the
 * leniency Anthropic's API already affords it today.
 *
 * @module dsh-plugins-mcp-client-oauth/schema-repair
 */

/** A plain JSON object, as opposed to an array, scalar, or `null`. */
type JsonRecord = Record<string, unknown>

/** Matches a JSON Schema 2020-12 in-document `$defs` reference. */
const LOCAL_DEFS_REF = /^#\/\$defs\/(.+)$/

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolve `node` against `defs`, inlining every `$ref: "#/$defs/<name>"` it
 * contains (recursively, so a resolved target's own `$ref`s are inlined
 * too) and dropping every `$defs` key once nothing can reference it
 * anymore. `inFlight` breaks a reference cycle: a `$defs` entry that (directly
 * or transitively) refers back to itself resolves to its literal siblings at
 * the point the cycle is detected, rather than recursing forever.
 */
function resolve(node: unknown, defs: JsonRecord | undefined, inFlight: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map(child => resolve(child, defs, inFlight))
  if (!isRecord(node)) return node

  const ref = node.$ref
  if (typeof ref === 'string') {
    const name = LOCAL_DEFS_REF.exec(ref)?.[1]
    if (name !== undefined) {
      const { $ref: _consumed, ...siblings } = node
      const resolvedSiblings = resolve(siblings, defs, inFlight)
      if (defs !== undefined && Object.hasOwn(defs, name) && !inFlight.has(name)) {
        const target = resolve(defs[name], defs, new Set(inFlight).add(name))
        // The `$ref` site's own siblings (e.g. a parameter-specific
        // `description`) take precedence over the target's same-named keys.
        return isRecord(target) && isRecord(resolvedSiblings)
          ? { ...target, ...resolvedSiblings }
          : resolvedSiblings
      }
      // Target missing or mid-cycle: fall back to the annotation-only
      // sibling keys, which is schema-valid (accepts any JSON value).
      return resolvedSiblings
    }
  }

  const out: JsonRecord = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === '$defs') continue // Inlined everywhere it was used; nothing left to reference it.
    out[key] = resolve(value, defs, inFlight)
  }
  return out
}

/**
 * Returns a deep copy of `schema` with every `$ref: "#/$defs/<name>"` it
 * contains resolved inline and every `$defs` dictionary removed. Non-object
 * input (including `undefined`) is returned unchanged — callers that pass
 * through an MCP tool's raw `inputSchema` may see a non-object value from a
 * malformed server, and that is a different, out-of-scope problem this
 * function does not try to fix.
 *
 * @param schema - Raw, untrusted `inputSchema` from an MCP `tools/list` entry.
 * @returns A deep copy with every local `$defs` reference inlined; never the
 *   same reference as `schema`.
 */
export function repairDanglingDefsRefs<T>(schema: T): T {
  if (!isRecord(schema)) return schema
  const defs = isRecord(schema.$defs) ? schema.$defs : undefined
  return resolve(schema, defs, new Set()) as T
}
