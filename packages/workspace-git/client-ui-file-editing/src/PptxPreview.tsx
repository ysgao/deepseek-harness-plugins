/**
 * Read-only `.pptx` body: a text-only extraction of each slide's shapes, in
 * presentation order — not a visual render (no layout, fonts, images, or
 * shape positions; no established lightweight browser library renders
 * OOXML slides faithfully, unlike `mammoth` for `.docx` or `xlsx` for
 * spreadsheets). `jszip` opens the archive; slide order comes from
 * `ppt/presentation.xml`'s own `<p:sldIdLst>` resolved through
 * `ppt/_rels/presentation.xml.rels` (the slide part's `slideN.xml` file
 * name is assigned at creation time and does not track reordering in the
 * PowerPoint UI, so a raw numeric/file-name sort would silently show stale
 * order after a deck has been reordered). Text extraction reads every
 * `<a:t>` run inside each `<a:p>` paragraph, across every shape's text
 * body — title, body placeholders, and plain text boxes alike; table cell
 * text and speaker notes are out of scope for this pass. Legacy binary
 * `.ppt` (pre-2007 OLE compound-file format) is not a zip archive at all,
 * so it never reaches this component — that extension never classifies to
 * `kind: 'pptx'` in the first place (see the consuming package's own
 * `classify.ts`).
 */
import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import css from './PptxPreview.module.css'

/** One slide's own extracted paragraphs, in reading order. */
interface PptxSlide {
  index: number
  lines: readonly string[]
}

/** Parse outcome for the currently previewed `.pptx` bytes. */
type PptxParseState =
  | { phase: 'parsing' }
  | { phase: 'ready'; slides: readonly PptxSlide[] }
  | { phase: 'error' }

export interface PptxPreviewProps {
  /** The file's raw bytes, as read by the caller (base64-decoded, undecoded further). */
  data: ArrayBuffer
  loadingLabel: string
  loadErrorLabel: string
  /** Per-slide heading, given its 1-based position. */
  slideLabel: (index: number) => string
  /** Empty-deck notice (no slides, or every slide has no extractable text). */
  emptyLabel: string
}

/** Every `<a:t>` text run inside one `<a:p>` paragraph, concatenated into that paragraph's own line. */
function paragraphText(paragraph: Element): string {
  return Array.from(paragraph.getElementsByTagName('a:t')).map(run => run.textContent ?? '').join('')
}

/** A slide XML part's own extracted, non-blank paragraph lines, in document order. */
function slideLines(xml: Document): string[] {
  return Array.from(xml.getElementsByTagName('a:p'))
    .map(paragraphText)
    .filter(line => line.trim() !== '')
}

/**
 * Resolve `ppt/slides/slideN.xml` part names in true presentation order,
 * via `presentation.xml`'s `<p:sldIdLst>` and the presentation part's own
 * relationships. Falls back to a numeric file-name sort — the order the
 * slide parts merely happen to be named, not necessarily the deck's own
 * current order — when either XML part is absent or unparsable, so a
 * malformed or unusual `.pptx` still shows something rather than nothing.
 * @param zip - the opened archive.
 * @returns absolute part paths (`ppt/slides/slideN.xml`), in the resolved order.
 */
async function resolveSlideOrder(zip: JSZip): Promise<string[]> {
  const fallback = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numberOf = (name: string): number => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0)
      return numberOf(a) - numberOf(b)
    })
  try {
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('string')
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string')
    if (presentationXml === undefined || relsXml === undefined) return fallback
    const parser = new DOMParser()
    const presentation = parser.parseFromString(presentationXml, 'application/xml')
    const rels = parser.parseFromString(relsXml, 'application/xml')
    if (presentation.getElementsByTagName('parsererror').length > 0) return fallback
    if (rels.getElementsByTagName('parsererror').length > 0) return fallback
    const targetById = new Map<string, string>()
    for (const relationship of Array.from(rels.getElementsByTagName('Relationship'))) {
      const id = relationship.getAttribute('Id')
      const target = relationship.getAttribute('Target')
      if (id !== null && target !== null) targetById.set(id, target)
    }
    const ordered = Array.from(presentation.getElementsByTagName('p:sldId'))
      .map(sldId => sldId.getAttribute('r:id'))
      .filter((id): id is string => id !== null)
      .map(id => targetById.get(id))
      .filter((target): target is string => target !== undefined)
      .map(target => `ppt/${target.replace(/^\.?\//, '')}`)
    return ordered.length > 0 ? ordered : fallback
  } catch {
    return fallback
  }
}

/**
 * Render one `.pptx` file's slides as extracted text, in presentation order.
 * @param props - see {@link PptxPreviewProps}.
 * @returns a loading/error notice while parsing, then one section per non-empty slide.
 */
export function PptxPreview({ data, loadingLabel, loadErrorLabel, slideLabel, emptyLabel }: PptxPreviewProps) {
  const [state, setState] = useState<PptxParseState>({ phase: 'parsing' })

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'parsing' })
    JSZip.loadAsync(data).then(async (zip) => {
      const order = await resolveSlideOrder(zip)
      const parser = new DOMParser()
      const slides: PptxSlide[] = []
      for (const [index, partPath] of order.entries()) {
        // One slide part's own decompression/parse failure (a corrupt
        // member in an otherwise-valid archive) drops just that slide
        // rather than failing the whole deck.
        try {
          const xmlText = await zip.file(partPath)?.async('string')
          if (xmlText === undefined) continue
          const xml = parser.parseFromString(xmlText, 'application/xml')
          if (xml.getElementsByTagName('parsererror').length > 0) continue
          slides.push({ index: index + 1, lines: slideLines(xml) })
        } catch {
          // Skip this slide only — see the comment above.
        }
      }
      if (cancelled) return
      setState({ phase: 'ready', slides })
    }).catch(() => {
      if (cancelled) return
      setState({ phase: 'error' })
    })
    return () => { cancelled = true }
  }, [data])

  if (state.phase === 'parsing') return <p className={css.notice}>{loadingLabel}</p>
  if (state.phase === 'error') return <p className={css.notice} role="alert">{loadErrorLabel}</p>
  const nonEmpty = state.slides.filter(slide => slide.lines.length > 0)
  if (nonEmpty.length === 0) return <p className={css.notice}>{emptyLabel}</p>

  return (
    <div className={css.root}>
      {nonEmpty.map(slide => (
        <section key={slide.index} className={css.slide}>
          <h3 className={css.slideHeading}>{slideLabel(slide.index)}</h3>
          {slide.lines.map((line, lineIndex) => (
            // eslint-disable-next-line react/no-array-index-key -- lines have no stable identity; the slide is read-only and never reorders.
            <p key={lineIndex} className={css.line}>{line}</p>
          ))}
        </section>
      ))}
    </div>
  )
}
