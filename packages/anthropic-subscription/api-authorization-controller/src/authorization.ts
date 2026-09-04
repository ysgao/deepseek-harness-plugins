/**
 * Host owner of the `authorization` Remote namespace: the RPC/stream bridge
 * that lets a browser configuration page run and answer `ctx.authorization`
 * flows for a Sign-in affordance. Mounted directly at the top level of a
 * composition — unlike `yga/deepseek-harness`'s fork, which nested this
 * class inside `@deepseek-ai/dsh-api-settings-controller`'s constructor, this
 * package owns no dependency on that package at all: `AuthorizationController`
 * only ever needed `ctx`, so nesting it there was an organizational choice,
 * not an architectural one — `@deepseek-ai/dsh-typert-loader` auto-discovers
 * any top-level Loader entry that exports `./typert`.
 *
 * `begin` resolves only once the whole attempt settles, which can take as
 * long as a human takes to click through a consent page, so its notices and
 * prompts never ride the RPC response. They instead ride `follow`, one stream
 * shared by every connected configuration page: `prompt-requested` replays as
 * a reconnect baseline for every prompt still pending, so any tab — not only
 * the one that called `begin` — can answer it through `respond`.
 * `authorization/settled` (declared by `@deepseek-ai/dsh-authorization`
 * itself) rides the ordinary Remote Event allowlist instead, since every
 * listener needs it and no answer is expected.
 *
 * @module dsh-plugins-api-authorization-controller/authorization
 */

import { Context } from '@deepseek-ai/cordis'
import { AuthorizationDeclinedError, AuthorizationError } from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationInteraction, AuthorizationOutcome,
} from '@deepseek-ai/dsh-authorization'
import type { AuthorizationEntry } from '@deepseek-ai/dsh-authorization/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthorizationStreamFrame, WireAuthorizationPrompt } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/** One prompt awaiting a browser answer, resolved or rejected by `respond`. */
interface PendingPrompt {
  readonly prompt: WireAuthorizationPrompt
  readonly resolve: (answer: string) => void
  readonly reject: (error: unknown) => void
}

/**
 * Map a thrown `AuthorizationError` to the Remote failure a configuration page
 * renders. `dsh-authorization`'s own `begin()` never lets a declined prompt
 * (`AuthorizationDeclinedError`) reach here — it observes the decline and
 * settles `begin()` as `{ status: 'cancelled' }` instead, the same outcome as
 * a withdrawn signal — so this maps only the seam's own refusals.
 */
function failure(error: unknown): RemoteError {
  if (error instanceof AuthorizationError) {
    if (error.code === 'NO_FLOW') return new RemoteError('authorization/not-found', error.message, {})
    if (error.code === 'ALREADY_IN_FLIGHT') return new RemoteError('authorization/in-flight', error.message, {})
    return new RemoteError('authorization/rejected', error.message, {})
  }
  return new RemoteError(
    'gateway/internal', error instanceof Error ? error.message : String(error), {},
  )
}

/** One `follow()` generation's private frame queue, mirroring `WorkspaceFollower`. */
class AuthorizationFollower {
  private readonly frames: AuthorizationStreamFrame[] = []
  private waiting: (() => void) | undefined
  private closed = false

  push(frame: AuthorizationStreamFrame): void {
    /* v8 ignore next -- closed followers are removed before later publication can reach them. */
    if (this.closed) return
    this.frames.push(frame)
    this.waiting?.()
  }

  close(): void {
    /* v8 ignore next -- `follow()`'s `finally` is this class's sole caller, always exactly once per instance. */
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<AuthorizationStreamFrame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        /* v8 ignore next -- one read owns the sole installed wait callback. */
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      /* v8 ignore next -- native signals and the private queue cannot change during this synchronous setup. */
      if (signal.aborted || this.closed || this.frames.length > 0) finish()
    })
  }
}

/** Fans notices and prompts out to every connected configuration page, and routes answers back. */
class AuthorizationFeed {
  private readonly followers = new Set<AuthorizationFollower>()
  private readonly pending = new Map<CredentialKey, PendingPrompt>()

  /**
   * Open one generation beginning with a baseline of every still-pending prompt.
   * @param signal - generation cancellation.
   */
  async *follow(signal: AbortSignal): AsyncIterable<AuthorizationStreamFrame> {
    signal.throwIfAborted()
    const follower = new AuthorizationFollower()
    this.followers.add(follower)
    try {
      for (const [key, { prompt }] of this.pending) yield { type: 'prompt-requested', key, prompt }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  /** Push a fire-and-forget notice from a running attempt. */
  notify(key: CredentialKey, notice: AuthorizationStreamFrame extends { type: 'notice' } ? never : import('@deepseek-ai/dsh-authorization/types').AuthorizationNotice): void {
    this.publish({ type: 'notice', key, notice })
  }

  /**
   * Register one attempt's pending prompt and wait for a connected page to
   * answer it, or for `signal` (the prompt's own — a flow retiring the
   * losing side of a race) to withdraw it. Never throws synchronously: every
   * failure — including the "already pending" guard — rejects the returned
   * promise, matching {@link AuthorizationInteraction.prompt}'s own
   * `Promise<string>` contract, since a caller that chains `.catch()`
   * without `await`ing (as the seam itself does — see
   * `@deepseek-ai/dsh-authorization`'s own `attempt()`) never sees a
   * synchronous throw.
   * @param key - the credential record the attempt is authorizing.
   * @param prompt - the wire-safe prompt (the seam's own `signal` already stripped).
   * @param signal - the prompt's own withdrawal signal (`AuthorizationPrompt.signal`,
   * stripped before the wire type); rejects with `signal.reason`, never
   * {@link AuthorizationDeclinedError} (the human did not decline — the flow retired the question).
   * @returns the typed text, or the chosen option's id.
   * @throws AuthorizationDeclinedError when `respond` is called with no answer.
   */
  ask(key: CredentialKey, prompt: WireAuthorizationPrompt, signal?: AbortSignal): Promise<string> {
    if (this.pending.has(key)) {
      return Promise.reject(
        new Error(`authorization: a prompt for "${key}" is already pending — a flow prompts one at a time`),
      )
    }
    if (signal?.aborted === true) return Promise.reject(signal.reason)
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => { reject(signal?.reason) }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(key, {
        prompt,
        resolve: (answer) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(answer)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
      })
      this.publish({ type: 'prompt-requested', key, prompt })
    }).finally(() => {
      this.pending.delete(key)
      this.publish({ type: 'prompt-resolved', key })
    })
  }

  /**
   * Answer the prompt pending for a key.
   * @param key - the credential record whose prompt is being answered.
   * @param answer - the typed text or chosen option id; `undefined` declines.
   * @throws RemoteError `authorization/prompt-not-found` when no prompt is pending for the key.
   */
  respond(key: CredentialKey, answer: string | undefined): void {
    const entry = this.pending.get(key)
    if (entry === undefined) {
      throw new RemoteError(
        'authorization/prompt-not-found', `no authorization prompt is pending for "${key}"`, {},
      )
    }
    if (answer === undefined) entry.reject(new AuthorizationDeclinedError())
    else entry.resolve(answer)
  }

  /**
   * Withdraw the prompt pending for a key, if any (idempotent no-op
   * otherwise) — called when the whole attempt is cancelled. The seam's own
   * `cancel()` settles `begin()` immediately without waiting for the
   * orphaned flow to unwind (its own `attempt()` races the withdrawal signal
   * against the flow's `run()`), so a flow blocked inside
   * `interaction.prompt()` would otherwise never learn the attempt ended —
   * leaving this key's `pending` entry, and thus `ask`'s "already pending"
   * guard, stuck until the process restarts. Rejects with a plain `Error`,
   * never {@link AuthorizationDeclinedError}: the human did not decline this
   * prompt, the caller withdrew the whole attempt out from under it.
   * @param key - the credential record whose pending prompt, if any, should be withdrawn.
   */
  withdrawPending(key: CredentialKey): void {
    const entry = this.pending.get(key)
    if (entry !== undefined) entry.reject(new Error(`authorization: the attempt for "${key}" was cancelled`))
  }

  private publish(frame: AuthorizationStreamFrame): void {
    for (const follower of this.followers) follower.push(frame)
  }
}

/** Bridge one attempt's `AuthorizationInteraction` onto the shared feed. */
function feedInteraction(feed: AuthorizationFeed, key: CredentialKey): AuthorizationInteraction {
  return {
    notify: (notice) => { feed.notify(key, notice) },
    prompt: (prompt) => {
      const { signal, ...wire } = prompt
      return feed.ask(key, wire, signal)
    },
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace.
 * Every method delegates to `ctx.authorization`, the seam a plugin registers
 * its own flow against; this controller supplies no flows of its own — it is
 * generic over any registered flow, `dsh-llm-pi-ai`'s Anthropic subscription
 * flow among them.
 */
export class AuthorizationController extends TypertRemoteService {
  // Cordis refuses `ctx.authorization` reads from a fiber that did not declare
  // the dependency, so without this every method below that delegates to the
  // seam (`list`, `begin`, `cancel`) throws "cannot get property
  // "authorization" without inject" at call time rather than at mount time.
  // `list` is the one a sign-in surface calls first, so the whole panel
  // silently renders nothing: its RPC resolves `ok: false`, the entry list
  // stays empty, and no key ever matches a registered flow.
  static inject = ['authorization']

  private readonly feed = new AuthorizationFeed()

  /** @param ctx - Host context where authorization flows may be registered. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /**
   * Every registered flow, for a surface listing what can be authorized.
   * @returns one entry per flow, in registration order.
   */
  @Remote
  list(): readonly AuthorizationEntry[] {
    return this.ctx.authorization.list()
  }

  /**
   * Open the shared notice/prompt stream, starting with a baseline of every
   * prompt still pending.
   * @param signal - generation cancellation.
   * @returns a baseline frame of pending prompts, then one frame per notice.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<AuthorizationStreamFrame> {
    return this.feed.follow(signal)
  }

  /**
   * Answer the prompt pending for a key, from whichever connected
   * configuration page is showing it.
   * @param key - the credential record whose prompt is being answered.
   * @param answer - the typed text or chosen option id; omit to decline.
   * @throws RemoteError `authorization/prompt-not-found` when no prompt is pending for the key.
   */
  @Remote
  respond(key: CredentialKey, answer: string | undefined): void {
    this.feed.respond(key, answer)
  }

  /**
   * Run one attempt to authorize a key, resolving only once it settles.
   * @param key - the credential record to authorize.
   * @param method - which of the flow's methods to run; defaults to its first.
   * @param signal - caller lifetime; abort withdraws the attempt like `cancel`.
   * @returns `authorized` once the flow's record is committed, or `cancelled` when declined or withdrawn.
   * @throws RemoteError `authorization/not-found` when no flow claims the key,
   * `authorization/in-flight` when one is already running, or `authorization/rejected` for any other seam refusal.
   */
  @Remote
  async begin(key: CredentialKey, method: string | undefined, signal: AbortSignal): Promise<AuthorizationOutcome> {
    // Withdraws this key's pending prompt on ANY caller-lifetime withdrawal,
    // not only the explicit `cancel()` RPC: the seam's own `begin()` aborts
    // its internal attempt controller from this same `signal` (a disconnect,
    // not just a Cancel click) and settles `cancelled` without waiting for
    // the orphaned flow to unwind — the identical leak `cancel()` closes via
    // `AuthorizationFeed.withdrawPending`, reachable here too since a
    // disconnected caller can no longer answer a prompt either way.
    const withdrawOnAbort = (): void => { this.feed.withdrawPending(key) }
    signal.addEventListener('abort', withdrawOnAbort, { once: true })
    try {
      return await this.ctx.authorization.begin({
        key,
        signal,
        interaction: feedInteraction(this.feed, key),
        ...(method === undefined ? {} : { method }),
      })
    } catch (error: unknown) {
      throw failure(error)
    } finally {
      signal.removeEventListener('abort', withdrawOnAbort)
    }
  }

  /**
   * Withdraw the attempt running for a key, if any (idempotent) — the Cancel
   * button's path, distinct from `begin`'s own `signal` because a
   * request/response transport answers Cancel on a second call, with no
   * handle on the first one's signal. Also withdraws this key's pending
   * prompt, if any: the seam's own cancellation settles `begin()`
   * immediately without waiting for the orphaned flow to unwind, so a flow
   * still blocked inside `interaction.prompt()` would otherwise never learn
   * the attempt ended, leaking `this.feed`'s pending entry forever (see
   * {@link AuthorizationFeed.withdrawPending}).
   * @param key - the credential record whose attempt should stop.
   */
  @Remote
  cancel(key: CredentialKey): void {
    this.ctx.authorization.cancel(key)
    this.feed.withdrawPending(key)
  }
}

export default AuthorizationController
