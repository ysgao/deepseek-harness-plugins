/**
 * Read-only `.rtf` body: the document's text, in reading order, one element
 * per paragraph — a text-only extraction, exactly as `PptxPreview` is for a
 * deck (see `./rtf/extract.ts` for what that includes and what it drops, and
 * why formatting is out of scope for a preview). RTF is plain-text markup, so
 * the raw file is still fully available in Edit mode and diffs as text.
 *
 * A document longer than {@link MAX_PARAGRAPHS} renders that leading window
 * plus a truncation notice, the same bound the table previews apply, so an
 * unusually long document cannot freeze the tab rendering its DOM nodes.
 */
import { useMemo } from 'react'
import { extractRtfText } from './rtf/extract.ts'
import css from './RtfPreview.module.css'

/** Complete-result bound: a longer document renders only this many leading paragraphs. */
const MAX_PARAGRAPHS = 2000

export interface RtfPreviewProps {
  /** The file's decoded text (the RTF markup). */
  text: string
  /** Truncation notice, given the shown and total paragraph counts. */
  truncatedLabel: (shown: number, total: number) => string
  /** Empty-document notice (no extractable text). */
  emptyLabel: string
}

/**
 * Render one `.rtf` file's extracted text.
 * @param props - see {@link RtfPreviewProps}.
 * @returns the document's paragraphs, or the empty notice.
 */
export function RtfPreview({ text, truncatedLabel, emptyLabel }: RtfPreviewProps) {
  const paragraphs = useMemo(() => extractRtfText(text), [text])

  if (paragraphs.length === 0) return <p className={css.notice}>{emptyLabel}</p>

  const shown = paragraphs.slice(0, MAX_PARAGRAPHS)

  return (
    <div className={css.root}>
      <div className={css.doc}>
        {shown.map((paragraph, index) => (
          // eslint-disable-next-line react/no-array-index-key -- a paragraph has no identity beyond its position; the document is read-only and never reorders.
          <p key={index} className={css.paragraph}>{paragraph}</p>
        ))}
      </div>
      {paragraphs.length > shown.length && (
        <p className={css.notice} role="status">{truncatedLabel(shown.length, paragraphs.length)}</p>
      )}
    </div>
  )
}
