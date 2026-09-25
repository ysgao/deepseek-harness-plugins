/**
 * This package's own text views of the Open XML formats, offered to the
 * relocated preview engine as ALTERNATIVES to its own renderers.
 *
 * The engine's preview can refuse or fail — the spreadsheet grid rejects a
 * workbook over its cell limit, an Office conversion can fall over — and
 * before this the reader was left with nothing. Registered here, a text view
 * of the same file is always one click away in the toolbar's viewer menu,
 * which upstream shows whenever more than one implementation matches a file.
 *
 * `builtin` priority, never `extension`. The engine registers its own bodies
 * first, so at equal priority and equal matched-suffix length it keeps the
 * default — the Office PDF conversion, the FortuneSheet grid — and these sit
 * beside it rather than displacing it. `extension` would silently make the
 * text view the default for every one of these formats.
 *
 * **Why this lives in the File tab's package rather than the document
 * host.** These components come from `dsh-plugins-client-ui-file-editing`,
 * and this bundle already contains every one of them through `FilePreview`.
 * Registering them here therefore costs no bytes at all. The same
 * registration in `dsh-plugins-client-ui-document-host` cost an activation
 * failure twice over: that bundle splits (the engine's pdf and excel bodies
 * are lazy chunks), and adding these made rolldown hoist a module shared by
 * the entry and those chunks — `clsx` one way, its own runtime helper the
 * other — which the closure-factory loader cannot resolve. See
 * `../../../tsdown.client-plugin-preset.ts`, which now fails the build on
 * exactly that.
 *
 * Legacy `.doc`/`.ppt` are deliberately absent: `mammoth` and `jszip` read
 * the Open XML containers only, so a registration for them would publish a
 * viewer that always fails. Those keep the engine's Host-side conversion,
 * which does read them.
 *
 * Plain text, code, Markdown, images and PDF are absent for a different
 * reason: the engine draws them well and rarely refuses, so a second entry
 * in the viewer menu of every text file opened would be mostly noise.
 * Adding them is a deliberate future step rather than an oversight — the
 * components are already in this bundle, so each is one more row in the
 * table below, and `FilePreview` can take its text straight from the
 * owner's `content` without this package reading the file again.
 * @module dsh-plugins-client-ui-conversation-files/text-viewers
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { DelimitedPreview } from 'dsh-plugins-client-ui-file-editing/src/DelimitedPreview.tsx'
import { DocxPreview } from 'dsh-plugins-client-ui-file-editing/src/DocxPreview.tsx'
import { PptxPreview } from 'dsh-plugins-client-ui-file-editing/src/PptxPreview.tsx'
import { XlsxPreview } from 'dsh-plugins-client-ui-file-editing/src/XlsxPreview.tsx'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/index.ts'

/** Implementation ids, namespaced to this package as upstream namespaces its own. */
const DOCX_ID = 'dsh-plugins-client-ui-conversation-files/docx-text'
const XLSX_ID = 'dsh-plugins-client-ui-conversation-files/xlsx-text'
const XLS_ID = 'dsh-plugins-client-ui-conversation-files/xls-text'
const PPTX_ID = 'dsh-plugins-client-ui-conversation-files/pptx-text'
const DELIMITED_ID = 'dsh-plugins-client-ui-conversation-files/delimited-text'

/** Standard document props plus this package's own copy. */
type ViewerProps = DocumentPreviewProps & PropsLocale<'conversation-files'>

/**
 * The document's bytes as a standalone `ArrayBuffer`.
 *
 * The owner hands a `Uint8Array`, which may be a VIEW onto a larger buffer;
 * these parsers take an `ArrayBuffer` and read it whole, so a view that does
 * not span its buffer is copied rather than unwrapped.
 * @param data - the owner's byte view.
 * @returns a buffer holding exactly this document's bytes.
 */
function bufferOf(data: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data.buffer
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}

/** `.docx` as its converted text. @param props - owner props and copy. @returns the document body. */
function DocxTextBody({ content, t }: ViewerProps): ReactNode {
  if (content.kind !== 'bytes') return null
  return <DocxPreview
    data={bufferOf(content.data)}
    loadingLabel={t('files.viewer.loading')}
    loadErrorLabel={t('files.viewer.loadError')}
  />
}

/** `.xlsx`/`.xls` as text tables. @param props - owner props and copy. @returns the sheets. */
function XlsxTextBody({ content, t }: ViewerProps): ReactNode {
  if (content.kind !== 'bytes') return null
  return <XlsxPreview
    data={bufferOf(content.data)}
    loadingLabel={t('files.viewer.loading')}
    loadErrorLabel={t('files.viewer.loadError')}
    truncatedLabel={(rows, cols) => t('files.viewer.xlsxTruncated', { rows, cols })}
    emptyLabel={t('files.viewer.xlsxEmpty')}
  />
}

/** `.pptx` as extracted per-slide text. @param props - owner props and copy. @returns the deck's text. */
function PptxTextBody({ content, t }: ViewerProps): ReactNode {
  if (content.kind !== 'bytes') return null
  return <PptxPreview
    data={bufferOf(content.data)}
    loadingLabel={t('files.viewer.loading')}
    loadErrorLabel={t('files.viewer.loadError')}
    slideLabel={index => t('files.viewer.pptxSlide', { index })}
    emptyLabel={t('files.viewer.pptxEmpty')}
  />
}

/** `.csv`/`.tsv` as a table. @param props - owner props and copy. @returns the table. */
function DelimitedTextBody({ resourceAddress, content, t }: ViewerProps): ReactNode {
  if (content.kind !== 'text') return null
  return <DelimitedPreview
    path={parseFileAddress(resourceAddress)?.path ?? resourceAddress}
    text={content.text}
    truncatedLabel={(rows, cols) => t('files.viewer.delimitedTruncated', { rows, cols })}
    emptyLabel={t('files.viewer.delimitedEmpty')}
  />
}

/**
 * Offer this package's text views to the engine, if one is composed in.
 *
 * Through `ctx.inject(['documentPreviews'])`, so a composition without
 * `dsh-plugins-client-ui-document-host` simply never registers them — there
 * is no engine to offer them to, and the File tab draws its own preview as
 * it always did.
 * @param ctx - Client root Context.
 * @param ns - this package's locale namespace, already registered.
 * @param t - bound translate for that namespace.
 */
export function registerTextViewers(
  ctx: Context, ns: 'conversation-files', t: TranslateNS<'conversation-files'>,
): void {
  ctx.inject(['documentPreviews'], (ctx) => {
    // `.xls` and `.csv`/`.tsv` take `extension`, which makes THIS viewer the
    // default and leaves the engine's grid one click away in the menu. That
    // inverts the usual arrangement, and only with evidence: the grid
    // crashes outright on those two formats. FortuneSheet mounts read-only
    // (`allowEdit: false`) and runs a layout effect that calls `setContext`
    // on every pass —
    //
    //   useLayoutEffect(() => { if (!context.allowEdit) setContext(…) },
    //     [context.luckysheetfile, context.currentSheetId,
    //      context.luckysheetCellUpdate, firstSelection])
    //
    // — which for these sheet shapes never settles, so React aborts with
    // "Maximum update depth exceeded" (#185) and the document slot crashes
    // to an empty body: no grid, and no error line either, because nothing
    // refused. Confirmed against real files of a few hundred rows, and the
    // stack lands in the bundled FortuneSheet, not in upstream's code or
    // ours — so it is not ours to fix and not the vendor's to be patched
    // (Article II).
    //
    // `.xlsx` is here too, reluctantly. The grid drew it correctly once and
    // then stopped — same file, same build, sometimes #185 and sometimes an
    // empty body that never settles — so the failure is not per-format but
    // per-run, and a default that works only sometimes is not a default.
    //
    // This is the one place the arrangement's "engine is the default" rule
    // is overridden, and only for the formats it demonstrably cannot draw.
    // The grid stays one click away for anyone who wants to try it, and
    // keeps every capability this viewer lacks (cell formatting, formulas,
    // multiple sheets as tabs). Re-test all three when the vendor pin moves:
    // if the grid settles reliably, these belong back at `builtin` and the
    // engine takes the default again.
    for (const [id, extensions, title, loading, priority, Body] of [
      [DOCX_ID, ['docx'], 'files.viewer.docxTitle', 'bytes-complete', 'builtin', DocxTextBody],
      [XLSX_ID, ['xlsx'], 'files.viewer.xlsxTitle', 'bytes-complete', 'extension', XlsxTextBody],
      [XLS_ID, ['xls'], 'files.viewer.xlsxTitle', 'bytes-complete', 'extension', XlsxTextBody],
      [PPTX_ID, ['pptx'], 'files.viewer.pptxTitle', 'bytes-complete', 'builtin', PptxTextBody],
      [DELIMITED_ID, ['csv', 'tsv'], 'files.viewer.delimitedTitle', 'text-pages', 'extension', DelimitedTextBody],
    ] as const) {
      ctx.effect(() => ctx.documentPreviews.register({
        id, extensions: [...extensions], priority, title: () => t(title), loading, wrap: false,
      }), `conversation-files: ${id} metadata`)
      ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
        { name: 'sidebar.right.tab.document', key: id, locale: ns },
        Body,
      )), `conversation-files: ${id} body`)
    }
  })
}
