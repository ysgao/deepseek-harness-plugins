/**
 * The notice/prompt fan-out behind the `mcpConnectors` namespace's `follow`
 * stream.
 *
 * Structurally the same shape as
 * `dsh-plugins-api-authorization-controller`'s own `AuthorizationFeed`, and
 * deliberately not shared with it. That controller is generic over the whole
 * `ctx.authorization` registry and is keyed by `CredentialKey`; this one is
 * keyed by connector id, carries connector-list invalidations on the same
 * stream, and — most importantly — lets this bundle stand alone. Sharing the
 * class would mean sharing the plugin row that mounts it, and two bundles
 * that each insert `@deepseek-ai/dsh-authorization`'s RPC controller into one
 * profile collide on the service name. Keeping a second, connector-scoped
 * stream here is a few dozen lines; making two bundles' install order
 * load-bearing for something as central as sign-in is not a trade worth
 * taking.
 *
 * @module dsh-plugins-api-mcp-connector-controller/feed
 */

import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationNotice } from '@deepseek-ai/dsh-authorization'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { McpConnectorStreamFrame, WireMcpPrompt } from './types.ts'

/** One prompt awaiting a browser answer, resolved or rejected by `respond`. */
interface PendingPrompt {
  readonly prompt: WireMcpPrompt
  readonly resolve: (answer: string) => void
  readonly reject: (error: unknown) => void
}

/** One `follow()` generation's private frame queue. */
class Follower {
  private readonly frames: McpConnectorStreamFrame[] = []
  private waiting: (() => void) | undefined
  private closed = false

  /** Queue one frame for this generation's reader. */
  push(frame: McpConnectorStreamFrame): void {
    /* v8 ignore next -- closed followers are removed before later publication can reach them. */
    if (this.closed) return
    this.frames.push(frame)
    this.waiting?.()
  }

  /** End this generation; a blocked reader wakes and finishes. */
  close(): void {
    /* v8 ignore next -- `follow()`'s `finally` is this class's sole caller, always exactly once per instance. */
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  /**
   * Drain queued frames until closed or aborted.
   * @param signal - generation cancellation.
   */
  async *read(signal: AbortSignal): AsyncIterable<McpConnectorStreamFrame> {
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
export class McpConnectorFeed {
  private readonly followers = new Set<Follower>()
  private readonly pending = new Map<string, PendingPrompt>()

  /**
   * Open one generation beginning with a baseline of every still-pending prompt.
   * @param signal - generation cancellation.
   * @returns the baseline frames, then one frame per event.
   */
  async *follow(signal: AbortSignal): AsyncIterable<McpConnectorStreamFrame> {
    signal.throwIfAborted()
    const follower = new Follower()
    this.followers.add(follower)
    try {
      for (const [id, { prompt }] of this.pending) yield { type: 'prompt-requested', id, prompt }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  /**
   * Push a fire-and-forget notice from a running attempt.
   * @param id - the connector the notice belongs to.
   * @param notice - the message, and any page or code it refers to.
   */
  notify(id: string, notice: AuthorizationNotice): void {
    this.publish({ type: 'notice', id, notice })
  }

  /**
   * Tell every connected page one attempt has finished.
   * @param id - the connector whose attempt settled.
   * @param status - how it ended.
   */
  settled(id: string, status: 'authorized' | 'cancelled' | 'failed'): void {
    this.publish({ type: 'settled', id, status })
  }

  /** Tell every connected page the connector list moved, so it refetches. */
  changed(): void {
    this.publish({ type: 'connectors-changed' })
  }

  /**
   * Register one attempt's pending prompt and wait for a connected page to
   * answer it, or for `signal` — the prompt's own, a flow retiring the losing
   * question of a race — to withdraw it. Never throws synchronously: every
   * failure rejects the returned promise instead, matching
   * {@link AuthorizationInteraction.prompt}'s own contract, since the seam
   * chains `.catch()` on this without awaiting it.
   * @param id - the connector being authorized.
   * @param prompt - the wire-safe prompt.
   * @param signal - the prompt's own withdrawal signal.
   * @returns the typed text, or the chosen option's id.
   */
  ask(id: string, prompt: WireMcpPrompt, signal?: AbortSignal): Promise<string> {
    if (this.pending.has(id)) {
      return Promise.reject(
        new Error(`mcp-connectors: a prompt for "${id}" is already pending — a flow prompts one at a time`),
      )
    }
    if (signal?.aborted === true) return Promise.reject(signal.reason)
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => { reject(signal?.reason) }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
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
      this.publish({ type: 'prompt-requested', id, prompt })
    }).finally(() => {
      this.pending.delete(id)
      this.publish({ type: 'prompt-resolved', id })
    })
  }

  /**
   * Answer the prompt pending for a connector.
   * @param id - the connector whose prompt is being answered.
   * @param answer - the typed text or chosen option id; `undefined` declines.
   * @throws RemoteError `mcp-connectors/prompt-not-found` when no prompt is pending.
   */
  respond(id: string, answer: string | undefined): void {
    const entry = this.pending.get(id)
    if (entry === undefined) {
      throw new RemoteError('mcp-connectors/prompt-not-found', `no sign-in prompt is pending for "${id}"`, {})
    }
    if (answer === undefined) entry.reject(new AuthorizationDeclinedError())
    else entry.resolve(answer)
  }

  /**
   * Withdraw the prompt pending for a connector, if any (idempotent).
   *
   * Called when the whole attempt is cancelled. The seam settles `begin()`
   * immediately on withdrawal without waiting for the orphaned flow to
   * unwind, so a flow still blocked inside `interaction.prompt()` would
   * otherwise never learn the attempt ended, leaving this map's entry — and
   * thus `ask`'s "already pending" guard — stuck until the process restarts.
   * Rejects with a plain `Error`, never {@link AuthorizationDeclinedError}:
   * the human did not decline, the caller withdrew the attempt out from under
   * the prompt.
   * @param id - the connector whose pending prompt should be withdrawn.
   */
  withdrawPending(id: string): void {
    this.pending.get(id)?.reject(new Error(`mcp-connectors: the sign-in attempt for "${id}" was cancelled`))
  }

  /**
   * Bridge one attempt's `AuthorizationInteraction` onto this feed.
   * @param id - the connector being authorized.
   * @returns the interaction to hand `ctx.authorization.begin()`.
   */
  interaction(id: string): AuthorizationInteraction {
    return {
      notify: (notice) => { this.notify(id, notice) },
      prompt: (prompt) => {
        const { signal, ...wire } = prompt
        return this.ask(id, wire, signal)
      },
    }
  }

  private publish(frame: McpConnectorStreamFrame): void {
    for (const follower of this.followers) follower.push(frame)
  }
}
