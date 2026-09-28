import { describe, expect, it } from 'vitest'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { wordCompletionSource } from './wordCompletion.ts'

/** Builds a `CompletionContext` for `doc` with the cursor at `pos`. */
function contextFor(doc: string, pos: number, explicit = false): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, explicit)
}

describe('wordCompletionSource', () => {
  it('offers a word repeated earlier in the buffer', () => {
    const doc = 'const workspaceId = 1\nconst x = works'
    const result = wordCompletionSource(contextFor(doc, doc.length))
    expect(result).not.toBeNull()
    expect(result?.options.map((option) => option.label)).toContain('workspaceId')
  })

  it('never suggests the token currently being typed', () => {
    const doc = 'workspaceId workspaceId'
    const result = wordCompletionSource(contextFor(doc, doc.length))
    // Both occurrences are the same token as the one being completed, so
    // there is nothing else in the document to suggest.
    expect(result).toBeNull()
  })

  it('ranks the nearer occurrence of a repeated word first', () => {
    const doc = 'far\n'.repeat(1) + 'near\nf'
    const result = wordCompletionSource(contextFor(doc, doc.length))
    expect(result?.options[0]?.label).toBe('near')
  })

  it('returns null outside a word with no explicit request', () => {
    const doc = 'workspaceId  '
    const result = wordCompletionSource(contextFor(doc, doc.length, false))
    expect(result).toBeNull()
  })

  it('still offers suggestions on an explicit request with an empty token', () => {
    const doc = 'workspaceId  '
    const result = wordCompletionSource(contextFor(doc, doc.length, true))
    expect(result?.options.map((option) => option.label)).toContain('workspaceId')
  })

  it('returns null in a document with no other word to suggest', () => {
    const doc = 'solo'
    const result = wordCompletionSource(contextFor(doc, doc.length))
    expect(result).toBeNull()
  })
})
