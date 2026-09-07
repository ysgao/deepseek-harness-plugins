/**
 * Read-only table body for delimiter-separated text (`.csv`, `.tsv`). The
 * file is plain text, so Edit and Diff treat it as text like any other — this
 * component is only about the *preview*, where a table is what a reader
 * actually wants from a CSV, the same way `XlsxPreview` is what they want from
 * a spreadsheet. It renders through the same plain `<table>` shape (and, in
 * `DelimitedPreview.module.css`, the same cell borders and scroll container)
 * so a `.csv` and an `.xlsx` of the same data read alike.
 *
 * The first row renders as the header (`<thead>`/`<th scope="col">`). CSV's
 * own RFC 4180 calls the header line optional, so this is an assumption — but
 * it is the near-universal convention, and it is purely presentational: a
 * headerless file shows its first record with header styling and no cell
 * value is altered, hidden, or reordered.
 *
 * A file larger than {@link MAX_ROWS}×{@link MAX_COLS} renders only that
 * leading window plus a truncation notice stating the file's true size, so a
 * multi-million-row export cannot freeze the tab rendering its DOM rows.
 * Parsing itself is bounded the same way — see `./delimited/parse.ts`.
 */
import { useMemo } from 'react'
import { detectDelimiter, parseDelimited } from './delimited/parse.ts'
import css from './DelimitedPreview.module.css'

/** Complete-result bound: a longer file renders only this many leading rows. */
const MAX_ROWS = 500
/** Complete-result bound: a wider file renders only this many leading columns. */
const MAX_COLS = 100

export interface DelimitedPreviewProps {
  /** Display path — read only to settle a `.tsv`'s delimiter without sniffing. */
  path: string
  /** The file's decoded text. */
  text: string
  /** Truncation notice, given the file's own full (pre-bound) row and column counts. */
  truncatedLabel: (rows: number, cols: number) => string
  /** Empty-file notice (no rows at all). */
  emptyLabel: string
}

/**
 * Render one delimited file as a table.
 * @param props - see {@link DelimitedPreviewProps}.
 * @returns the table (with a truncation notice when bounded), or the empty notice.
 */
export function DelimitedPreview({ path, text, truncatedLabel, emptyLabel }: DelimitedPreviewProps) {
  const table = useMemo(
    () => parseDelimited(text, detectDelimiter(path, text), { maxRows: MAX_ROWS, maxCols: MAX_COLS }),
    [path, text],
  )

  // Every row is padded to the window's widest row, so the header and body
  // cells stay in one grid even when the file's rows are ragged.
  const colCount = useMemo(
    () => table.rows.reduce((max, row) => Math.max(max, row.length), 0),
    [table],
  )

  if (table.rows.length === 0) return <p className={css.notice}>{emptyLabel}</p>

  const [header, ...body] = table.rows
  const truncated = table.totalRows > table.rows.length || table.totalCols > colCount

  return (
    <div className={css.root}>
      <div className={css.tableScroll}>
        <table className={css.table}>
          <thead>
            <tr>
              {Array.from({ length: colCount }, (_unused, colIndex) => (
                // eslint-disable-next-line react/no-array-index-key -- a column has no identity beyond its position; the table is read-only and never reorders.
                <th key={colIndex} scope="col">{header?.[colIndex] ?? ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              // eslint-disable-next-line react/no-array-index-key -- see above.
              <tr key={rowIndex}>
                {Array.from({ length: colCount }, (_unused, colIndex) => (
                  // eslint-disable-next-line react/no-array-index-key -- see above.
                  <td key={colIndex}>{row[colIndex] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className={css.notice} role="status">{truncatedLabel(table.totalRows, table.totalCols)}</p>
      )}
    </div>
  )
}
