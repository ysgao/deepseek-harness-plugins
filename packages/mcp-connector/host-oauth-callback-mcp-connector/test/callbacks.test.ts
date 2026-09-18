/**
 * The web-server delivery path: a redirect that arrives over HTTP reaches the
 * attempt waiting for that exact `state`, and nothing else does.
 *
 * Worth testing rather than eyeballing because every branch here ends in the
 * same visible place — a page in a browser tab — while the consequential half
 * is invisible: which pending attempt was resolved, rejected, or left waiting.
 * A delivery routed to the wrong attempt would redeem one connector's code
 * into another's grant.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CALLBACK_PATH, McpOAuthCallbacks } from '../src/index.ts'

/** One captured HTTP answer. */
interface Answer {
  status: number
  body: string
}

/** Drive one request through the handler and capture what the browser would see. */
function request(callbacks: McpOAuthCallbacks, url: string): Answer {
  const answer: Answer = { status: 0, body: '' }
  const res = {
    writeHead(status: number) {
      answer.status = status
      return this
    },
    end(body: string) {
      answer.body = body
    },
  } as unknown as ServerResponse
  callbacks.handle({ url } as IncomingMessage, res)
  return answer
}

/** A sink with no attempts registered. */
function sink(): McpOAuthCallbacks {
  return new McpOAuthCallbacks(new Context())
}

describe('delivering a redirect', () => {
  it('resolves the attempt waiting under that state', async () => {
    const callbacks = sink()
    const waiting = callbacks.await('state-one', new AbortController().signal)

    const answer = request(callbacks, `${CALLBACK_PATH}?state=state-one&code=the-code&iss=https://issuer.example`)

    expect(answer.status).toBe(200)
    expect(answer.body).toContain('Signed in')
    await expect(waiting).resolves.toEqual({ code: 'the-code', iss: 'https://issuer.example' })
  })

  it('leaves every other attempt waiting', async () => {
    const callbacks = sink()
    const mine = callbacks.await('state-mine', new AbortController().signal)
    const theirs = callbacks.await('state-theirs', new AbortController().signal)
    const settled = vi.fn()
    void theirs.then(settled, settled)

    request(callbacks, `${CALLBACK_PATH}?state=state-mine&code=mine`)
    await expect(mine).resolves.toEqual({ code: 'mine' })

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
  })

  it('answers a state nobody is waiting for without resolving anything', () => {
    const answer = request(sink(), `${CALLBACK_PATH}?state=unknown&code=stray`)
    expect(answer.status).toBe(404)
    expect(answer.body).toContain('No sign-in is waiting')
  })

  it('answers a redirect carrying no state', () => {
    const answer = request(sink(), CALLBACK_PATH)
    expect(answer.status).toBe(400)
    expect(answer.body).toContain('Nothing to sign in')
  })

  it('fails the attempt when the authorization server refused', async () => {
    const callbacks = sink()
    const waiting = callbacks.await('state-refused', new AbortController().signal)

    const answer = request(
      callbacks,
      `${CALLBACK_PATH}?state=state-refused&error=access_denied&error_description=User%20said%20no`,
    )

    expect(answer.status).toBe(200)
    expect(answer.body).toContain('Sign-in refused')
    await expect(waiting).rejects.toThrow(/access_denied.*User said no/u)
  })

  it('fails the attempt when the redirect carries no code', async () => {
    const callbacks = sink()
    const waiting = callbacks.await('state-empty', new AbortController().signal)

    const answer = request(callbacks, `${CALLBACK_PATH}?state=state-empty`)

    expect(answer.status).toBe(400)
    await expect(waiting).rejects.toThrow(/no authorization code/u)
  })

  it('never caches a response, since the URL carries the code', () => {
    const callbacks = sink()
    const headers: Record<string, string>[] = []
    const res = {
      writeHead(_status: number, sent: Record<string, string>) {
        headers.push(sent)
        return this
      },
      end() {},
    } as unknown as ServerResponse
    callbacks.handle({ url: `${CALLBACK_PATH}?state=x&code=y` } as IncomingMessage, res)
    expect(headers[0]?.['cache-control']).toBe('no-store')
    expect(headers[0]?.['referrer-policy']).toBe('no-referrer')
  })
})

describe('retiring a wait', () => {
  it('rejects when the race is called off, and frees the state', async () => {
    const callbacks = sink()
    const aborter = new AbortController()
    const waiting = callbacks.await('state-retired', aborter.signal)

    aborter.abort(new Error('another racer won'))
    await expect(waiting).rejects.toThrow('another racer won')

    // The state is free again: a later attempt may reuse it, and a stray
    // delivery for the retired one finds nobody waiting.
    expect(request(callbacks, `${CALLBACK_PATH}?state=state-retired&code=late`).status).toBe(404)
  })

  it('refuses a signal that is already aborted', async () => {
    const aborter = new AbortController()
    aborter.abort(new Error('too late'))
    await expect(sink().await('state-dead', aborter.signal)).rejects.toThrow('too late')
  })

  it('refuses a second attempt under one state', async () => {
    const callbacks = sink()
    void callbacks.await('state-shared', new AbortController().signal).catch(() => {})
    await expect(callbacks.await('state-shared', new AbortController().signal))
      .rejects.toThrow(/already waiting/u)
  })
})
