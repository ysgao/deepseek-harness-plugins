/**
 * Line splitting shared by every line-numbered surface in this package —
 * `FilePreview`'s text body, `FileEditor`'s live preview pane, and
 * `OntologyPreview`. Its own module rather than one of those components' so
 * the ontology preview can use it without importing the component that
 * renders it (which imports the ontology preview back).
 */
import type { ReadBlockLine } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Split text into `ReadBlock` lines, 1-based file line numbers.
 * @param text - the file's decoded text.
 * @returns one entry per line of content, in file order.
 */
export function toReadBlockLines(text: string): ReadBlockLine[] {
  // A trailing newline must not manufacture a phantom empty final line: a
  // file ending in "\n" splits to N lines of real content, not N+1.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  if (body === '') return []
  return body.split('\n').map((line, index) => ({ number: index + 1, text: line }))
}
