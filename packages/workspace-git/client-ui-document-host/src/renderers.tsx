/**
 * The formats the relocated engine has no renderer for, contributed to it
 * the way any third party would: `ctx.documentPreviews.register` plus a
 * body in the document slot, at the `extension` band that outranks builtins.
 *
 * This is the other half of "relocate the seat, never the renderers". The
 * engine gained this bundle's *surface*; these give it this bundle's own
 * genuinely-missing *formats*, without a fork and without asking upstream for
 * anything. An OWL/RDF ontology falls to a plain text body otherwise (its
 * serialization is not decidable from the extension, which is why it has its
 * own detector), an `.rtf` falls to showing its markup instead of its
 * document, and a Google Drive shortcut file (`.gdoc`/`.gsheet`/`.gslides`)
 * falls to showing its pointer JSON instead of the document it names.
 *
 * Everything else this bundle used to preview by itself — code, Markdown,
 * images, PDF, Office, spreadsheets, CSV — the engine already does at least
 * as well, so nothing is registered for those: a second implementation at
 * `extension` priority would silently outrank the better one.
 *
 * This View-mode registration is only half of the Google format's own
 * story — Edit mode never goes through this engine at all (see
 * `dsh-plugins-client-ui-conversation-files`'s `FileView`, which renders
 * `GoogleDocEditor` directly, the same way it already renders `FileEditor`
 * for a text kind, regardless of whether this package is composed in).
 * @module dsh-plugins-client-ui-document-host/renderers
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
// Deep imports, not the package barrel. The barrel re-exports `FilePreview`,
// whose own graph pulls mammoth, xlsx and jszip — several megabytes that
// would land in THIS package's entry bundle, which every boot downloads,
// to render formats that need none of them. Measured: the barrel took
// the entry from 287 kB to 3.9 MB and dragged the PDF asset map out of its
// lazy chunk with it. `GoogleDocPreview` is as light as `OntologyPreview`/
// `RtfPreview` — plain JSON parsing and an `<iframe>`, no third-party parser
// — so it joins them here rather than in `dsh-plugins-client-ui-
// conversation-files`'s `text-viewers.tsx` (that module's own doc comment
// explains why ITS registrations, which reuse components the heavy barrel
// already costs that package nothing extra for, belong there instead).
import { GoogleDocPreview } from 'dsh-plugins-client-ui-file-editing/src/GoogleDocPreview.tsx'
import type { GoogleLabels } from 'dsh-plugins-client-ui-file-editing/src/GoogleDocPreview.tsx'
import { OntologyPreview } from 'dsh-plugins-client-ui-file-editing/src/OntologyPreview.tsx'
import { RtfPreview } from 'dsh-plugins-client-ui-file-editing/src/RtfPreview.tsx'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/index.ts'
import type { DocumentHostKey } from './locales.ts'

/** Implementation ids: this package's name, then the format, as upstream's own bodies are keyed. */
const ONTOLOGY_ID = 'dsh-plugins-client-ui-document-host/ontology'
const RTF_ID = 'dsh-plugins-client-ui-document-host/rtf'
const GDOC_ID = 'dsh-plugins-client-ui-document-host/gdoc'
const GSHEET_ID = 'dsh-plugins-client-ui-document-host/gsheet'
const GSLIDES_ID = 'dsh-plugins-client-ui-document-host/gslides'

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
    <OntologyPreview
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
    <RtfPreview
      text={content.text}
      truncatedLabel={(shown, total) => t('rtf.truncated', { shown, total })}
      emptyLabel={t('rtf.empty')}
    />
  )
}

/**
 * Google Drive shortcut body: the engine hands over the shortcut's own
 * (small) JSON text; this resolves it to a file id and draws Google's
 * embedded read-only preview. One implementation serves all three shortcut
 * kinds — `kind` is pinned per registration by the thin wrapper components
 * below (`GdocDocumentBody`/`GsheetDocumentBody`/`GslidesDocumentBody`),
 * since each extension needs its own stable slot-registration identity.
 * @param props - document owner props, this package's copy, and the
 * resolved shortcut kind.
 * @returns the embedded preview, or nothing until text has arrived.
 */
function GoogleDocumentBody(
  { content, t, kind }: HostDocumentProps & { kind: 'gdoc' | 'gsheet' | 'gslides' },
): ReactNode {
  if (content.kind !== 'text') return null
  const labels: GoogleLabels = {
    appName: (googleKind) => {
      if (googleKind === 'gdoc') return t('google.gdocApp')
      if (googleKind === 'gsheet') return t('google.gsheetApp')
      return t('google.gslidesApp')
    },
    invalid: t('google.invalid'),
  }
  return <GoogleDocPreview kind={kind} text={content.text} labels={labels} />
}

/** `GoogleDocumentBody` pinned to `'gdoc'` — a named, module-level component per kind so each slot registration gets one stable identity, rather than a fresh closure built inside the registration loop. */
function GdocDocumentBody(props: HostDocumentProps): ReactNode {
  return <GoogleDocumentBody {...props} kind="gdoc" />
}

/** `GoogleDocumentBody` pinned to `'gsheet'` — see `GdocDocumentBody`. */
function GsheetDocumentBody(props: HostDocumentProps): ReactNode {
  return <GoogleDocumentBody {...props} kind="gsheet" />
}

/** `GoogleDocumentBody` pinned to `'gslides'` — see `GdocDocumentBody`. */
function GslidesDocumentBody(props: HostDocumentProps): ReactNode {
  return <GoogleDocumentBody {...props} kind="gslides" />
}

/** One registration's worth of Google-shortcut metadata: its id, extension, and which pinned body/title key it pairs with. */
interface GoogleFormatRow {
  readonly id: string
  readonly extension: string
  readonly titleKey: 'google.gdocApp' | 'google.gsheetApp' | 'google.gslidesApp'
  readonly Body: (props: HostDocumentProps) => ReactNode
}

/** The three Google Drive shortcut kinds this package registers. */
const GOOGLE_FORMATS: readonly GoogleFormatRow[] = [
  { id: GDOC_ID, extension: 'gdoc', titleKey: 'google.gdocApp', Body: GdocDocumentBody },
  { id: GSHEET_ID, extension: 'gsheet', titleKey: 'google.gsheetApp', Body: GsheetDocumentBody },
  { id: GSLIDES_ID, extension: 'gslides', titleKey: 'google.gslidesApp', Body: GslidesDocumentBody },
]

/**
 * Register every format with the engine.
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

  for (const { id, extension, titleKey, Body } of GOOGLE_FORMATS) {
    ctx.effect(() => ctx.documentPreviews.register({
      id,
      extensions: [extension],
      priority: 'extension',
      title: () => t(titleKey),
      // Small JSON, same as ontology/rtf: the whole shortcut fits in the
      // first (and only) page.
      loading: 'text-pages',
      wrap: false,
    }), `document-host: ${id} metadata`)
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
      { name: 'sidebar.right.tab.document', key: id, locale: ns },
      Body,
    )), `document-host: ${id} body`)
  }
}

export type { DocumentHostKey }
