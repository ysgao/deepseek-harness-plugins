import { describe, expect, it } from 'vitest'
import { isPausePoint, predictNextSentence } from './sentencePrediction.ts'

describe('predictNextSentence', () => {
  it('suggests the sentence that followed a matching sentence elsewhere', () => {
    const doc = 'Run the build. Then run the tests. Run the build. '
    expect(predictNextSentence(doc, doc.length)).toBe('Then run the tests.')
  })

  it('is case- and whitespace-insensitive when matching a repeated sentence', () => {
    const doc = 'Run   the BUILD. Then run the tests. Run the build. '
    expect(predictNextSentence(doc, doc.length)).toBe('Then run the tests.')
  })

  it('returns null when the just-finished sentence never repeats', () => {
    const doc = 'This sentence is entirely unique in this document. '
    expect(predictNextSentence(doc, doc.length)).toBeNull()
  })

  it('returns null outside a pause point (mid-sentence, no trailing space yet)', () => {
    const doc = 'Run the build. Then run the tests. Run the build'
    expect(predictNextSentence(doc, doc.length)).toBeNull()
  })

  it('prefers the nearest matching occurrence, mirroring wordCompletionSource ranking', () => {
    const doc = 'Step one. Alpha result. Step one. Beta result. Step one. '
    // The nearest prior "Step one." is the one right before the cursor,
    // whose own successor is "Beta result." — not the far one's "Alpha result.".
    expect(predictNextSentence(doc, doc.length)).toBe('Beta result.')
  })

  it('does not suggest a sentence back to itself when it only repeats consecutively', () => {
    const doc = 'Step one. Step one. '
    expect(predictNextSentence(doc, doc.length)).toBeNull()
  })

  it('ignores very short sentences as unreliable match keys', () => {
    const doc = 'OK. Great. OK. '
    expect(predictNextSentence(doc, doc.length)).toBeNull()
  })

  it('falls back to line matching for punctuation-free repeated lines', () => {
    const doc = '- Buy milk and eggs\n- Prep the report\n- Buy milk and eggs\n'
    // pos = right after the newline the writer just typed following the
    // third (repeated) line.
    expect(predictNextSentence(doc, doc.length)).toBe('- Prep the report')
  })

  it('returns null right after a blank line', () => {
    const doc = 'Some text\n\n'
    expect(predictNextSentence(doc, doc.length)).toBeNull()
  })

  it('returns null on an empty document', () => {
    expect(predictNextSentence('', 0)).toBeNull()
  })
})

describe('isPausePoint', () => {
  it('is true right after a sentence-ending period and space', () => {
    const doc = 'Hello world. '
    expect(isPausePoint(doc, doc.length)).toBe(true)
  })

  it('is true right after a sentence-ending "!" inside closing quotes', () => {
    const doc = 'She said "wait!" '
    expect(isPausePoint(doc, doc.length)).toBe(true)
  })

  it('is false mid-sentence', () => {
    const doc = 'Hello wor'
    expect(isPausePoint(doc, doc.length)).toBe(false)
  })

  it('is true right after the newline that closes a non-empty line', () => {
    const doc = '- first item\n'
    expect(isPausePoint(doc, doc.length)).toBe(true)
  })

  it('is false at the bare end of the buffer with no newline yet (still possibly mid-word)', () => {
    const doc = '- first item'
    expect(isPausePoint(doc, doc.length)).toBe(false)
  })

  it('is false at the start of the document', () => {
    expect(isPausePoint('', 0)).toBe(false)
  })

  it('is false right after a blank line', () => {
    const doc = 'para one\n\n'
    expect(isPausePoint(doc, doc.length)).toBe(false)
  })
})
