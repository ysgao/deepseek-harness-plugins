/**
 * Which sign-in failures deserve the "register a client by hand" advice.
 *
 * The advice used to be a pre-flight refusal, which was wrong in a way nothing
 * caught: a server that publishes an RFC 7591 `registration_endpoint` has no
 * client to configure and acquires one mid-attempt, so refusing before trying
 * made every such server — Atlassian's among them — impossible to sign in to
 * from either surface. Now it hangs off the failure, and what these pin is
 * that it hangs off the *right* failure: attaching it to an unrelated error
 * would send someone to a Google Cloud console over a network blip.
 */
import { describe, expect, it } from 'vitest'
import { signInFailure } from '../src/cli.ts'

/** The MCP SDK's own wording for an auth server that cannot self-register. */
const NO_DCR = 'Incompatible auth server: does not support dynamic client registration'

describe('signInFailure', () => {
  it('advises registering a client when the server cannot register one itself', () => {
    const message = signInFailure('gmail', new Error(NO_DCR), false)
    expect(message).toContain(NO_DCR)
    expect(message).toContain('dsh --profile mcp set gmail --client-id')
  })

  it('leaves an unrelated failure alone, so nobody is sent to a console over a network blip', () => {
    const message = signInFailure('atlassiancloud', new Error('fetch failed'), false)
    expect(message).toBe('fetch failed')
  })

  it('does not advise configuring a client that is already configured', () => {
    // Same SDK error, but a stored client means registration was not the
    // missing piece and the advice would be a dead end.
    expect(signInFailure('gmail', new Error(NO_DCR), true)).toBe(NO_DCR)
  })

  it('reports a non-Error rejection rather than dropping it', () => {
    expect(signInFailure('gmail', 'boom', false)).toBe('boom')
  })
})
