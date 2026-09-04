/**
 * Read-only spreadsheet body for `.xlsx` (Open XML) and legacy `.xls`
 * (BIFF8 binary) alike — `xlsx` (SheetJS) parses both from the same raw
 * bytes without the caller needing to distinguish them. Each sheet renders
 * as a plain HTML `<table>` built from `sheet_to_json`'s array-of-arrays
 * form (React's own text-node escaping, not `dangerouslySetInnerHTML` —
 * unlike `DocxPreview`, a cell value is never treated as markup). A
 * workbook with more than one sheet gets a tab strip; a sheet larger than
 * {@link MAX_ROWS}×{@link MAX_COLS} renders only that leading window plus a
 * truncation notice, so an unusually large spreadsheet cannot freeze the
 * tab rendering thousands of DOM rows.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { read, utils } from 'xlsx'
import css from './XlsxPreview.module.css'

/** Complete-result bound per sheet: a larger sheet renders only this many rows. */
const MAX_ROWS = 500
/** Complete-result bound per sheet: a wider row renders only this many leading cells. */
const MAX_COLS = 100

/** Parse outcome for the currently previewed spreadsheet bytes. */
type XlsxParseState =
  | { phase: 'parsing' }
  | { phase: 'ready'; sheets: readonly XlsxSheet[] }
  | { phase: 'error' }

/** One parsed sheet: its name and a bounded array-of-arrays of display strings. */
interface XlsxSheet {
  name: string
  rows: readonly (readonly string[])[]
  /** The sheet's own full row count, before the {@link MAX_ROWS} bound. */
  totalRows: number
  /** The sheet's own full column count (its widest row), before the {@link MAX_COLS} bound. */
  totalCols: number
}

export interface XlsxPreviewProps {
  /** The file's raw bytes, as read by the caller (base64-decoded, undecoded further). */
  data: ArrayBuffer
  loadingLabel: string
  loadErrorLabel: string
  /** Truncation notice, given the sheet's own full (pre-bound) row and column counts. */
  truncatedLabel: (rows: number, cols: number) => string
  /** Empty-workbook notice (no sheets, or every sheet has no cells). */
  emptyLabel: string
}

/**
 * Render one spreadsheet's parsed sheets, with a tab strip when there is
 * more than one.
 * @param props - see {@link XlsxPreviewProps}.
 * @returns a loading/error notice while parsing, then the active sheet's table.
 */
export function XlsxPreview({ data, loadingLabel, loadErrorLabel, truncatedLabel, emptyLabel }: XlsxPreviewProps) {
  const [state, setState] = useState<XlsxParseState>({ phase: 'parsing' })
  const [activeSheet, setActiveSheet] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'parsing' })
    setActiveSheet(0)
    // Parsing is synchronous CPU work in `xlsx`; deferred to a microtask so
    // the "parsing" notice actually paints first for a large workbook,
    // mirroring `DocxPreview`/`PptxPreview`'s own genuinely-async shape.
    Promise.resolve().then(() => {
      if (cancelled) return
      const workbook = read(new Uint8Array(data), { type: 'array' })
      const sheets: XlsxSheet[] = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name]
        const full: unknown[][] = sheet === undefined
          ? []
          : utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
        const totalRows = full.length
        const totalCols = full.reduce((max, row) => Math.max(max, row.length), 0)
        const rows = full.slice(0, MAX_ROWS).map(row =>
          row.slice(0, MAX_COLS).map(cell => (cell === null || cell === undefined ? '' : String(cell))),
        )
        return { name, rows, totalRows, totalCols }
      })
      setState({ phase: 'ready', sheets })
    }).catch(() => {
      if (cancelled) return
      setState({ phase: 'error' })
    })
    return () => { cancelled = true }
  }, [data])

  const sheet = state.phase === 'ready' ? state.sheets[activeSheet] : undefined

  const colCount = useMemo(
    () => sheet === undefined ? 0 : sheet.rows.reduce((max, row) => Math.max(max, row.length), 0),
    [sheet],
  )
  const truncated = sheet !== undefined && (sheet.totalRows > sheet.rows.length || sheet.totalCols > colCount)

  if (state.phase === 'parsing') return <p className={css.notice}>{loadingLabel}</p>
  if (state.phase === 'error') return <p className={css.notice} role="alert">{loadErrorLabel}</p>
  if (state.sheets.length === 0 || state.sheets.every(one => one.rows.length === 0)) {
    return <p className={css.notice}>{emptyLabel}</p>
  }

  return (
    <div className={css.root}>
      {state.sheets.length > 1 && (
        <div className={css.tabs} role="tablist">
          {state.sheets.map((one, index) => (
            <button
              key={one.name}
              type="button"
              role="tab"
              aria-selected={index === activeSheet}
              className={clsx(css.tab, index === activeSheet && css.tabActive)}
              onClick={() => { setActiveSheet(index) }}
            >
              {one.name}
            </button>
          ))}
        </div>
      )}
      {sheet !== undefined && (
        <div className={css.tableScroll}>
          <table className={css.table}>
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                // eslint-disable-next-line react/no-array-index-key -- rows have no stable identity; the sheet is read-only and never reorders.
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
      )}
      {truncated && sheet !== undefined && (
        <p className={css.notice} role="status">{truncatedLabel(sheet.totalRows, sheet.totalCols)}</p>
      )}
    </div>
  )
}
