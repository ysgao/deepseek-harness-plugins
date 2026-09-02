/**
 * Browser-safe wire types for the `authorization` Remote namespace.
 *
 * @module dsh-plugins-api-authorization-controller/types
 */

import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'

/** `Omit`, applied per union member instead of to the flattened union (TS's built-in `Omit` is not distributive). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/**
 * `AuthorizationPrompt` without its `signal` field, distributed over the
 * `kind` union member-by-member: the plain (non-distributive) `Omit` would
 * collapse the union into one flattened object type, losing `kind`-based
 * narrowing (`prompt.kind === 'select'` would no longer see `options`) — a
 * wire prompt still needs its `kind` to discriminate `text`/`secret`/`select`.
 * The seam's own cancellation `signal` is flow-internal and never wire-safe.
 */
export type WireAuthorizationPrompt = DistributiveOmit<AuthorizationPrompt, 'signal'>

/**
 * One frame of the `authorization` namespace's `follow` stream. Every
 * connected configuration page shares this stream: `prompt-requested`
 * replays as the reconnect baseline for every prompt still pending, so a
 * late-joining tab can answer a flow another tab started.
 */
export type AuthorizationStreamFrame =
  | { readonly type: 'notice'; readonly key: CredentialKey; readonly notice: AuthorizationNotice }
  | { readonly type: 'prompt-requested'; readonly key: CredentialKey; readonly prompt: WireAuthorizationPrompt }
  | { readonly type: 'prompt-resolved'; readonly key: CredentialKey }

/** Authorization events available to a Remote Event assembly (see `@deepseek-ai/dsh-authorization`'s own `Events` declaration). */
type AuthorizationRemoteEvent = 'authorization/settled'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No flow claims the requested key. */
    'authorization/not-found': {}
    /** An attempt for the requested key is already running. */
    'authorization/in-flight': {}
    /** Any other seam refusal (unknown method, uncommitted flow). */
    'authorization/rejected': {}
    /** No prompt is pending for the requested key. */
    'authorization/prompt-not-found': {}
  }

  interface TypertRemoteEventSelection extends Record<AuthorizationRemoteEvent, true> {}
}
