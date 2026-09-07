/**
 * RFC 4180 parsing for delimiter-separated text (`.csv`, `.tsv`), for
 * `../DelimitedPreview.tsx`'s table body. Hand-rolled rather than taken from
 * `xlsx` (SheetJS), which this package already depends on and can read a CSV:
 * that reader wants the whole file as one string *and* builds a full workbook
 * model from it, while this preview needs a bounded leading window of a file
 * that may be far larger than what it will ever display — so the scan below
 * stops as soon as it has the rows the preview asked for, and never
 * materializes the rest.
 *
 * Quoting follows RFC 4180 as the reference, with the two tolerances every
 * real-world file needs: a bare `"` inside an unquoted field is data (not the
 * start of a quoted field), and rows may end with either `\n` or `\r\n`. A
 * quoted field may contain the delimiter, doubled quotes (`""` → one `"`), and
 * line breaks, which is exactly why a CSV cannot be split on newlines and
 * needs a real scanner.
 */

/** Field delimiter of a delimited text file. */
export type Delimiter = ',' | '\t' | ';' | '|'

/** The bounded parse of a delimited file: the window to display, plus what the file really holds. */
export interface DelimitedTable {
  /** The parsed window, at most `maxRows` × `maxCols`. */
  readonly rows: readonly (readonly string[])[]
  /** Rows in the whole file, which may exceed `rows.length`. */
  readonly totalRows: number
  /** Widest row in the whole file, which may exceed the window's own column count. */
  readonly totalCols: number
  /** The delimiter the parse used. */
  readonly delimiter: Delimiter
}

/** Bounds for one parse: how much of the file the caller will actually render. */
export interface DelimitedBounds {
  readonly maxRows: number
  readonly maxCols: number
}

/** Candidate delimiters, in the order {@link detectDelimiter} prefers them on a tie. */
const CANDIDATES: readonly Delimiter[] = [',', '\t', ';', '|']

/** Head of the file the delimiter sniff reads. */
const SNIFF_LENGTH = 64 * 1024

/**
 * Field delimiter for a delimited file. A `.tsv` is tab-separated by
 * definition, so its extension settles it; `.csv` does not settle anything —
 * the format is `,` by name but `;` in locales where the comma is the decimal
 * separator (and Excel writes those files as `.csv` too) — so its delimiter is
 * counted off the content. The count runs over whole rows and only outside
 * quoted fields, so a comma inside `"Smith, John"` cannot outvote the real
 * delimiter.
 * @param path - absolute or display path (its extension is the `.tsv` shortcut).
 * @param text - the file's text; only its head is counted.
 * @returns the delimiter to parse with.
 */
export function detectDelimiter(path: string, text: string): Delimiter {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase()
  if (base.endsWith('.tsv') || base.endsWith('.tab')) return '\t'
  const head = text.slice(0, SNIFF_LENGTH)
  let best: Delimiter = ','
  let bestCount = 0
  for (const candidate of CANDIDATES) {
    const count = countOutsideQuotes(head, candidate)
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

/**
 * Occurrences of `delimiter` in `text` that fall outside a quoted field —
 * the only ones that would actually separate fields.
 * @param text - the text to count over.
 * @param delimiter - the candidate delimiter.
 * @returns how many separating occurrences the text holds.
 */
function countOutsideQuotes(text: string, delimiter: Delimiter): number {
  let count = 0
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char !== '"') continue
      // A doubled quote inside a quoted field is an escaped quote, not the end.
      if (text[index + 1] === '"') index++
      else quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === delimiter) count++
  }
  return count
}

/**
 * Parse the leading `bounds.maxRows` rows of a delimited file.
 *
 * Scanning stops once the window is full *and* the remaining rows have been
 * counted, so the returned `totalRows`/`totalCols` describe the whole file
 * while only the window is materialized. The counting tail still has to
 * honor quoting (a quoted field may hold line breaks), so it walks the
 * characters too — it just keeps no field text.
 * @param text - the file's full decoded text.
 * @param delimiter - the field delimiter, from {@link detectDelimiter}.
 * @param bounds - the display window's own row/column bounds.
 * @returns the window plus the file's true row/column counts.
 */
export function parseDelimited(text: string, delimiter: Delimiter, bounds: DelimitedBounds): DelimitedTable {
  const rows: string[][] = []
  let totalRows = 0
  let totalCols = 0

  let row: string[] = []
  let field = ''
  let columns = 0
  let quoted = false
  // Whether anything at all has been seen since the last row terminator; a
  // file's final newline must not manufacture a phantom trailing row, but a
  // genuinely empty line in the middle of the file is a real (single, empty)
  // row and is kept.
  let started = false

  /** Close the current field into the current row (respecting the column bound). */
  const endField = (): void => {
    columns++
    if (row.length < bounds.maxCols) row.push(field)
    field = ''
  }

  /** Close the current row, recording it when the row window still has space. */
  const endRow = (): void => {
    endField()
    totalRows++
    if (columns > totalCols) totalCols = columns
    if (rows.length < bounds.maxRows) rows.push(row)
    row = []
    columns = 0
    started = false
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          if (row.length < bounds.maxCols) field += '"'
          index++
        } else {
          quoted = false
        }
        continue
      }
      if (row.length < bounds.maxCols) field += char
      continue
    }
    if (char === '"' && field === '') {
      // A quote only opens a quoted field at the start of a field; anywhere
      // else it is data (the RFC 4180 tolerance noted in the module comment).
      quoted = true
      started = true
      continue
    }
    if (char === delimiter) {
      endField()
      started = true
      continue
    }
    if (char === '\n') {
      endRow()
      continue
    }
    // A lone \r is a row terminator too (classic Mac line endings); a \r\n
    // pair terminates on its \n, so the \r before one is dropped here.
    if (char === '\r') {
      if (text[index + 1] === '\n') continue
      endRow()
      continue
    }
    if (row.length < bounds.maxCols) field += char
    started = true
  }
  // A trailing partial row (no terminating newline) is a real row; a file that
  // ended exactly on its terminator has nothing left to close.
  if (started || field !== '' || row.length > 0) endRow()

  return { rows, totalRows, totalCols, delimiter }
}
