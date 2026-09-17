/**
 * Browser-safe wire types for the `mcpConnectors` Remote namespace.
 *
 * @module dsh-plugins-api-mcp-connector-controller/types
 */

import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization/types'

export type {
  McpConnectorDefinition, McpConnectorEntry, McpConnectorHealth, McpConnectorTransport, McpOAuthStatus,
} from 'dsh-plugins-mcp-connector-registry/types'

/** `Omit`, applied per union member instead of to the flattened union (TS's built-in `Omit` is not distributive). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/**
 * `AuthorizationPrompt` without its `signal` field, distributed over the
 * `kind` union member-by-member so `kind`-based narrowing survives the
 * conversion. The seam's own cancellation `signal` is flow-internal and never
 * wire-safe.
 */
export type WireMcpPrompt = DistributiveOmit<AuthorizationPrompt, 'signal'>

/**
 * One frame of the `mcpConnectors` namespace's `follow` stream.
 *
 * Keyed by connector id rather than by credential key: a browser surface
 * addresses a connector by the name the human typed, and deriving the folded
 * credential key from it is Host business.
 *
 * Every connected configuration page shares this stream, and
 * `prompt-requested` replays as the reconnect baseline for every prompt still
 * pending, so a late-joining tab can answer a sign-in another tab started.
 */
/**
 * How one sign-in attempt ended, as its caller sees it.
 *
 * Named rather than written inline on `authorize`'s return type: the Typert
 * generator names every type crossing the wire through its declaring module's
 * package export, and an anonymous object literal in a method signature has no
 * such name to resolve.
 */
export interface McpSignInOutcome {
  /** `authorized` once the grant is committed; `cancelled` when the human declined or the caller withdrew. */
  status: 'authorized' | 'cancelled'
}

export type McpConnectorStreamFrame =
  | { readonly type: 'notice'; readonly id: string; readonly notice: AuthorizationNotice }
  | { readonly type: 'prompt-requested'; readonly id: string; readonly prompt: WireMcpPrompt }
  | { readonly type: 'prompt-resolved'; readonly id: string }
  | { readonly type: 'settled'; readonly id: string; readonly status: 'authorized' | 'cancelled' | 'failed' }
  /** The connector list changed — a surface refetches rather than guessing what moved. */
  | { readonly type: 'connectors-changed' }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No connector is configured under the requested id. */
    'mcp-connectors/not-found': {}
    /** The definition cannot be mounted as written. */
    'mcp-connectors/invalid': {}
    /** A sign-in attempt for the connector is already running. */
    'mcp-connectors/in-flight': {}
    /** The connector has no registered sign-in flow — it is not an OAuth connector, or the seam is absent. */
    'mcp-connectors/no-flow': {}
    /** No prompt is pending for the requested connector. */
    'mcp-connectors/prompt-not-found': {}
    /** Any other refusal from the authorization seam. */
    'mcp-connectors/rejected': {}
  }
}
