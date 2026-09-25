/**
 * The two formats the relocated engine has no renderer for, contributed to
 * it the way any third party would: `ctx.documentPreviews.register` plus a
 * body in the document slot, at the `extension` band that outranks builtins.
 *
 * This is the other half of "relocate the seat, never the renderers". The
 * engine gained this bundle's *surface*; these give it this bundle's own two
 * genuinely-missing *formats*, without a fork and without asking upstream for
 * anything. An OWL/RDF ontology falls to a plain text body otherwise (its
 * serialization is not decidable from the extension, which is why it has its
 * own detector), and an `.rtf` falls to showing its markup instead of its
 * document.
 *
 * Everything else this bundle used to preview by itself — code, Markdown,
 * images, PDF, Office, spreadsheets, CSV — the engine already does at least
 * as well, so nothing is registered for those: a second implementation at
 * `extension` priority would silently outrank the better one.
 * @module dsh-plugins-client-ui-document-host/renderers
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
// Deep imports, not the package barrel. The barrel re-exports `FilePreview`,
// whose own graph pulls mammoth, xlsx and jszip — several megabytes that
// would land in THIS package's entry bundle, which every boot downloads,
// to render two formats that need none of them. Measured: the barrel took
// the entry from 287 kB to 3.9 MB and dragged the PDF asset map out of its
// lazy chunk with it.
import {
  LazyDelimitedPreview, LazyDocxPreview, LazyOntologyPreview, LazyPptxPreview, LazyRtfPreview, LazyXlsxPreview,
} from './lazy-bodies.tsx'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/index.ts'
import type { DocumentHostKey } from './locales.ts'

/** Implementation ids: this package's name, then the format, as upstream's own bodies are keyed. */
const ONTOLOGY_ID = 'dsh-plugins-client-ui-document-host/ontology'
const RTF_ID = 'dsh-plugins-client-ui-document-host/rtf'
const DOCX_ID = 'dsh-plugins-client-ui-document-host/docx-text'
const XLSX_ID = 'dsh-plugins-client-ui-document-host/xlsx-text'
const PPTX_ID = 'dsh-plugins-client-ui-document-host/pptx-text'
const DELIMITED_ID = 'dsh-plugins-client-ui-document-host/delimited-text'

/**
 * OWL/RDF serializations. Every one of these is used for several concrete
 * syntaxes (`.owl` alone covers RDF/XML, Functional, Manchester and Turtle),
 * which is exactly why the body detects the syntax from the content rather
 * than trusting the suffix.
 */
const ONTOLOGY_EXTENSIONS = ['owl', 'rdf', 'ttl', 'trig', 'n3', 'nt', 'nq', 'omn', 'ofn', 'owx'] as const

/** Standard document props plus this package's own copy. */
type HostDocumentProps = DocumentPreviewProps & PropsLocale<'document-host'>

/**
 * Read the file path out of the document's own resource address.
 * @param address - the body's `resourceAddress`.
 * @returns the decoded path, or the address itself when it is not a file address.
 */
function pathOf(address: string): string {
  return parseFileAddress(address)?.path ?? address
}

/**
 * Ontology body: the engine supplies accumulated text, this draws the
 * syntax-aware view.
 * @param props - document owner props and this package's copy.
 * @returns the highlighted ontology, or nothing until text has arrived.
 */
function OntologyDocumentBody({ resourceAddress, content, t }: HostDocumentProps): ReactNode {
  // `text-pages` loading means text arrives in windows; an ontology is read
  // top-down, so drawing what has landed is right and the body simply grows.
  if (content.kind !== 'text') return null
  return (
    <LazyOntologyPreview
      path={pathOf(resourceAddress)}
      text={content.text}
      labels={{
        codeLabel: t('renderer.codeLabel'),
        wrapLabel: t('renderer.wrap'),
        unwrapLabel: t('renderer.unwrap'),
        window: (shown, total) => t('renderer.window', { shown, total }),
        copy: t('renderer.copy'),
        copied: t('renderer.copied'),
        collapseAria: t('renderer.collapseAria'),
        expandAria: count => t('renderer.expandAria', { count }),
        collapse: t('renderer.collapse'),
        expand: count => t('renderer.expandRest', { count }),
      }}
    />
  )
}

/**
 * RTF body: the markup is text on the wire, the document is what is drawn.
 * @param props - document owner props and this package's copy.
 * @returns the extracted document text.
 */
function RtfDocumentBody({ content, t }: HostDocumentProps): ReactNode {
  if (content.kind !== 'text') return null
  return (
    <LazyRtfPreview
      text={content.text}
      truncatedLabel={(shown, total) => t('rtf.truncated', { shown, total })}
      emptyLabel={t('rtf.empty')}
    />
  )
}

/**
 * The document's bytes as a standalone `ArrayBuffer`.
 *
 * The owner hands a `Uint8Array`, which may be a VIEW onto a larger buffer;
 * these parsers take an `ArrayBuffer` and read it whole, so a view that does
 * not start at 0 or stop at the end must be copied rather than unwrapped.
 * @param data - the owner's byte view.
 * @returns a buffer containing exactly this document's bytes.
 */
function bufferOf(data: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data.buffer
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}

/** `.docx` as its converted text. @param props - owner props and copy. @returns the document body. */
function DocxDocumentBody({ content, t }: HostDocumentProps): ReactNode {
  if (content.kind !== 'bytes') return null
  return <LazyDocxPreview
    data={bufferOf(content.data)}
    loadingLabel={t('text.loading')}
    loadErrorLabel={t('text.loadError')}
    loading={t('text.loading')}
  />
}

/** `.xlsx`/`.xls` as text tables. @param props - owner props and copy. @returns the sheets. */
function XlsxDocumentBody({ content, t }: HostDocumentProps): ReactNode {
  if (content.kind !== 'bytes') return null
  return <LazyXlsxPreview
    data={bufferOf(content.data)}
    loadingLabel={t('text.loading')}
    loadErrorLabel={t('text.loadError')}
    truncatedLabel={(rows, cols) => t('xlsx.truncated', { rows, cols })}
    emptyLabel={t('xlsx.empty')}
    loading={t('text.loading')}
  />
}

/** `.pptx` as extracted per-slide text. @param props - owner props and copy. @returns the deck's text. */
function PptxDocumentBody({ content, t }: HostDocumentProps): ReactNode {
  if (content.kind !== 'bytes') return null
  return <LazyPptxPreview
    data={bufferOf(content.data)}
    loadingLabel={t('text.loading')}
    loadErrorLabel={t('text.loadError')}
    slideLabel={index => t('pptx.slide', { index })}
    emptyLabel={t('pptx.empty')}
    loading={t('text.loading')}
  />
}

/** `.csv`/`.tsv` as a table. @param props - owner props and copy. @returns the table. */
function DelimitedDocumentBody({ resourceAddress, content, t }: HostDocumentProps): ReactNode {
  if (content.kind !== 'text') return null
  return <LazyDelimitedPreview
    path={pathOf(resourceAddress)}
    text={content.text}
    truncatedLabel={(rows, cols) => t('delimited.truncated', { rows, cols })}
    emptyLabel={t('delimited.empty')}
    loading={t('text.loading')}
  />
}

/**
 * Register both formats with the engine.
 * @param ctx - this plugin's Context, after the engine's own apply() has provided `documentPreviews`.
 * @param ns - this package's locale namespace, already registered.
 */
export function registerHostRenderers(ctx: Context, ns: 'document-host'): void {
  const t = ctx.locale.bind(ns)
  ctx.effect(() => ctx.documentPreviews.register({
    id: ONTOLOGY_ID,
    extensions: ONTOLOGY_EXTENSIONS,
    // `extension`, not `builtin`: this is exactly the band upstream reserves
    // for an outside implementation, and it is what puts an ontology in this
    // body instead of the plain-text one that would otherwise claim it.
    priority: 'extension',
    title: () => t('ontology.title'),
    loading: 'text-pages',
    wrap: false,
  }), 'document-host: ontology metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: ONTOLOGY_ID, locale: ns },
    OntologyDocumentBody,
  )), 'document-host: ontology body')

  ctx.effect(() => ctx.documentPreviews.register({
    id: RTF_ID,
    extensions: ['rtf'],
    priority: 'extension',
    title: () => t('rtf.title'),
    loading: 'text-pages',
    wrap: false,
  }), 'document-host: rtf metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: RTF_ID, locale: ns },
    RtfDocumentBody,
  )), 'document-host: rtf body')

  // The Open XML formats, as this bundle's own text views — ALTERNATIVES, not
  // replacements. `builtin`, not `extension`: the engine registers its own
  // bodies first, so at equal priority and equal suffix length it keeps the
  // default (the Office PDF conversion, the spreadsheet grid) and these
  // appear beside it in the toolbar's viewer menu, which the engine shows
  // whenever more than one implementation matches.
  //
  // That menu is the point. The grid refuses a workbook over its cell limit
  // and a conversion can fail; when it does, a text view of the same file is
  // one click away instead of nothing at all.
  //
  // Legacy `.doc`/`.ppt` are deliberately absent: `mammoth` and `jszip` read
  // the Open XML containers only, so registering them here would publish a
  // viewer that always fails. Those stay with the engine's Host conversion,
  // which does read them.
  for (const [id, extensions, title, loading, Body] of [
    [DOCX_ID, ['docx'], 'docx.title', 'bytes-complete', DocxDocumentBody],
    [XLSX_ID, ['xlsx', 'xls'], 'xlsx.title', 'bytes-complete', XlsxDocumentBody],
    [PPTX_ID, ['pptx'], 'pptx.title', 'bytes-complete', PptxDocumentBody],
    [DELIMITED_ID, ['csv', 'tsv'], 'delimited.title', 'text-pages', DelimitedDocumentBody],
  ] as const) {
    ctx.effect(() => ctx.documentPreviews.register({
      id, extensions: [...extensions], priority: 'builtin', title: () => t(title), loading, wrap: false,
    }), `document-host: ${id} metadata`)
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
      { name: 'sidebar.right.tab.document', key: id, locale: ns },
      Body,
    )), `document-host: ${id} body`)
  }
}

export type { DocumentHostKey }
