/**
 * Line-numbered, syntax-highlighted preview for an OWL/RDF ontology file
 * (`.owl`, `.rdf`, and their serialization-specific siblings — see the
 * consuming packages' own `classify.ts`). Ontology files are ordinary text
 * files, so Edit and Diff need nothing special from them; what they do need is
 * highlighting, and the extension alone does not say which of the OWL 2
 * serializations a file holds — `.owl` is used for RDF/XML, Functional Syntax,
 * Manchester Syntax, and Turtle alike. So this component detects the
 * serialization from the file's own content (`./ontology/syntax.ts`) and then
 * splits two ways:
 *
 * - The XML serializations (RDF/XML, OWL/XML) and JSON-LD render as a plain
 *   `ReadBlock` with shiki's own `xml`/`json` grammar. The app's one syntax
 *   highlighter already covers them properly, and delegating keeps its lazy
 *   grammar loading and viewport-bounded highlighting rather than
 *   reimplementing either.
 * - Functional, Manchester, and the Turtle family have no shiki grammar at
 *   all, so those render here, through this package's own line tokenizer
 *   (`./ontology/tokenize.ts`), in a body that matches `ReadBlock`'s own
 *   appearance down to the gutter width (see `./OntologyPreview.module.css`)
 *   — a reader must not be able to tell which of the two arms drew a file.
 *
 * Only the rows actually rendered are tokenized (the head/tail slices while
 * capped, everything once expanded), which is what keeps a large ontology —
 * the normal case, not the exception — as cheap to open as any other text
 * file of the same length.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { DEFAULT_READ_MAX_LINES, ReadBlock, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReadBlockLabels, ReadBlockLine } from '@deepseek-ai/dsh-client-ui-primitives'
import { toReadBlockLines } from './lines.ts'
import { detectOntologySyntax } from './ontology/syntax.ts'
import type { OntologyDialect } from './ontology/syntax.ts'
import { tokenizeOntologyLine } from './ontology/tokenize.ts'
import type { OntologyTokenKind } from './ontology/tokenize.ts'
import css from './OntologyPreview.module.css'

/** Class per token kind; `plain` has none and inherits the body foreground. */
const CLASS_BY_KIND: Readonly<Record<OntologyTokenKind, string | undefined>> = {
  plain: undefined,
  comment: css.comment,
  string: css.string,
  iri: css.iri,
  keyword: css.keyword,
  blank: css.blank,
  datatype: css.datatype,
  langtag: css.langtag,
  number: css.number,
  prefixed: css.prefixed,
  punctuation: css.punctuation,
}

/** One rendered row: its file line number and the highlighted runs of its text. */
interface HighlightedLine {
  readonly number: number
  readonly runs: ReactNode
}

/** Tokenize a slice of lines into rendered runs (only rows that are actually displayed reach here). */
function highlight(lines: readonly ReadBlockLine[], dialect: OntologyDialect): HighlightedLine[] {
  return lines.map(line => ({
    number: line.number,
    runs: tokenizeOntologyLine(line.text, dialect).map((token, index) => (
      <span key={index} className={CLASS_BY_KIND[token.kind]}>{token.text}</span>
    )),
  }))
}

export interface OntologyPreviewProps {
  /** Display path (the banner label). */
  path: string
  /** The file's decoded text. */
  text: string
  /**
   * Localized chrome. The same `ReadBlockLabels` seat the text preview
   * already fills, since this component shows the same controls (copy, and the
   * collapse/expand fold) — a caller needs no ontology-specific copy.
   */
  labels: ReadBlockLabels
  /** Height cap in content lines before the middle collapses (default {@link DEFAULT_READ_MAX_LINES}, as `ReadBlock`). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/**
 * Render one ontology file's highlighted preview.
 * @param props - see {@link OntologyPreviewProps}.
 * @returns the preview element (a delegated `ReadBlock` for the XML/JSON
 * serializations, this component's own body for the rest).
 */
export function OntologyPreview({ path, text, labels, maxLines = DEFAULT_READ_MAX_LINES, className }: OntologyPreviewProps) {
  const profile = useMemo(() => detectOntologySyntax(path, text), [path, text])
  const lines = useMemo(() => toReadBlockLines(text), [text])
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | undefined>(undefined)

  // A fast unmount right after a copy (switching files, closing the tab) must
  // not let the pending timer call setState on an unmounted component.
  useEffect(() => () => { window.clearTimeout(copiedTimerRef.current) }, [])

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, text])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  // Same fold arithmetic as `ReadBlock`'s, so a capped ontology file shows the
  // same head/tail split at the same line count as a capped source file.
  const hidden = lines.length - maxLines
  const capped = hidden > 0 && !expanded
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const dialect = profile.dialect

  const head = useMemo(
    () => dialect === undefined ? [] : highlight(capped ? lines.slice(0, headLines) : lines, dialect),
    [dialect, capped, lines, headLines],
  )
  const tail = useMemo(
    () => dialect === undefined || !capped ? [] : highlight(lines.slice(lines.length - tailLines), dialect),
    [dialect, capped, lines, tailLines],
  )

  // The XML/JSON serializations are the app's own highlighter's job (see this
  // module's doc comment); everything below this line is the arm for the
  // serializations it has no grammar for.
  if (profile.delegateLang !== undefined) {
    return (
      <ReadBlock
        label={path}
        lines={lines}
        totalLines={lines.length}
        lang={profile.delegateLang}
        labels={labels}
        maxLines={maxLines}
        className={className}
      />
    )
  }

  const rows = (slice: readonly HighlightedLine[]) => slice.map(line => (
    <div key={line.number} className={css.line}>
      <span className={css.gutter} aria-hidden>{line.number}</span>
      <span className={css.content}>{line.runs}</span>
    </div>
  ))

  return (
    <div className={clsx(css.block, className)} data-ontology="">
      <div className={css.banner}>
        <div className={css.label}>{path}</div>
        <div className={css.action}>
          <span className={css.syntax}>{profile.bannerId}</span>
          {/* Empty files omit Copy to avoid replacing the clipboard with an empty string. */}
          {lines.length > 0 && (
            <button type="button" className={css.copyButton} onClick={onCopy}>
              {copied ? labels.copied : labels.copy}
            </button>
          )}
        </div>
      </div>
      <div className={css.body}>
        {rows(head)}
        {hidden > 0 && (
          <button
            type="button"
            className={css.expand}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? labels.collapseAria : labels.expandAria(hidden)}
          >
            {expanded ? labels.collapse : labels.expand(hidden)}
          </button>
        )}
        {rows(tail)}
      </div>
    </div>
  )
}
