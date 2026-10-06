/**
 * Google Drive "shortcut" files: the small JSON file Google Drive Desktop
 * (and Google Takeout) writes in place of a native Google Doc/Sheet/Slide it
 * cannot sync as a real document — `.gdoc`, `.gsheet`, `.gslides`. A typical
 * one looks like:
 *
 * ```json
 * {"url": "https://docs.google.com/document/d/FILE_ID/edit?usp=drivesdk", "resource_id": "document:FILE_ID", "email": "reader@example.com"}
 * ```
 *
 * The file carries no document content at all — only enough to find the
 * real thing on Google's own servers — so "parsing" it means resolving a
 * file id and a doc type from whichever of its fields survived, never
 * reading a body out of it.
 *
 * Parsing lives apart from the body that draws it (`./GoogleDocPreview.tsx`)
 * for the same reason `./kinds.ts` splits from `./FilePreview.tsx`: a caller
 * that only wants to validate or classify a shortcut should not need to pull
 * in a React tree to do it.
 * @module dsh-plugins-client-ui-file-editing/googleShortcut
 */

/** The three shortcut kinds this package recognizes. */
export type GoogleShortcutKind = 'gdoc' | 'gsheet' | 'gslides'

/** Which Google editor a shortcut opens — also the first path segment of every modern `docs.google.com` share link for it. */
export type GoogleDocType = 'document' | 'spreadsheets' | 'presentation'

/** The doc type a shortcut's own extension implies, used whenever nothing inside the file says otherwise. */
const DOC_TYPE_BY_KIND: Readonly<Record<GoogleShortcutKind, GoogleDocType>> = {
  gdoc: 'document', gsheet: 'spreadsheets', gslides: 'presentation',
}

/** `resource_id`'s own type word (singular, unlike the URL path segment) mapped to {@link GoogleDocType}. */
const DOC_TYPE_BY_RESOURCE_PREFIX: Readonly<Record<string, GoogleDocType>> = {
  document: 'document', spreadsheet: 'spreadsheets', presentation: 'presentation',
}

/** A Drive file id: Google's own alphabet, in practice always at least a few characters long. */
const FILE_ID_PATTERN = /^[\w-]{10,}$/

/** The modern share-link shape: `docs.google.com/<document|spreadsheets|presentation>/d/<id>/...`. */
const MODERN_URL = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/
/** The legacy shape the original Google Drive desktop client wrote: `docs.google.com/open?id=<id>`. */
const LEGACY_OPEN_URL = /^https:\/\/docs\.google\.com\/open\?id=([\w-]+)/

/** A shortcut file's resolved identity: enough to build both the read-only preview and the real editor's URL. */
export interface GoogleShortcut {
  readonly docType: GoogleDocType
  readonly fileId: string
  /**
   * The URL a reader opens to actually edit the document. The shortcut's own
   * `url` field when it had a usable one — it carries whatever sharing
   * params Drive wrote — else a plain `/edit` URL built from the resolved
   * `docType`/`fileId`.
   */
  readonly editUrl: string
  /** Google's own cross-origin-embeddable, read-only viewer for this document — see `./GoogleDocPreview.tsx`. */
  readonly previewUrl: string
}

/**
 * Read a field as a non-empty string, or `undefined` for anything else
 * (absent, wrong type, or blank).
 * @param record - the parsed shortcut object.
 * @param key - the field to read.
 * @returns the trimmed string, or `undefined`.
 */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Resolve an id and (when the URL itself names one) a doc type from the
 * shortcut's own `url` field.
 * @param url - the shortcut's `url` field, if it had a usable one.
 * @returns the id and doc type the URL names, or `null` when it matches neither known shape.
 */
function fromUrl(url: string | undefined): { fileId: string; docType: GoogleDocType | null } | null {
  if (url === undefined) return null
  const modern = MODERN_URL.exec(url)
  if (modern !== null) {
    // Both groups are required (no `?` in the pattern), so a successful
    // match always fills them — the `undefined` checks are purely to
    // satisfy `noUncheckedIndexedAccess`, not a real "could be missing" case.
    const docType = modern[1]
    const fileId = modern[2]
    if (docType === undefined || fileId === undefined) return null
    return { docType: docType as GoogleDocType, fileId }
  }
  const legacy = LEGACY_OPEN_URL.exec(url)
  if (legacy === null) return null
  const fileId = legacy[1]
  // The legacy `open?id=` shape names no doc type at all — the extension
  // (via the caller-supplied `kind`) is the only signal for it.
  return fileId === undefined ? null : { docType: null, fileId }
}

/**
 * Resolve an id and doc type from the shortcut's own `resource_id` field
 * (`"<type>:<id>"`, e.g. `"document:1AbCd..."`).
 * @param resourceId - the shortcut's `resource_id` field, if it had one.
 * @returns the id and doc type it names, or `null` when the field is absent or unparsable.
 */
function fromResourceId(resourceId: string | undefined): { fileId: string; docType: GoogleDocType | null } | null {
  if (resourceId === undefined) return null
  const colon = resourceId.indexOf(':')
  if (colon < 0) return null
  const prefix = resourceId.slice(0, colon)
  const fileId = resourceId.slice(colon + 1)
  if (fileId === '') return null
  return { fileId, docType: DOC_TYPE_BY_RESOURCE_PREFIX[prefix] ?? null }
}

/**
 * Parse a Google Drive shortcut file's raw text into its resolved identity.
 *
 * Tries, in order: a modern `docs.google.com/<type>/d/<id>` URL (the only
 * source that can override `kind`'s own doc type — everything else only
 * ever confirms it), a legacy `open?id=` URL, `resource_id`, then the bare
 * `doc_id` field some writers include instead. Returns `null` when none of
 * them yields anything shaped like a real file id — a shortcut this package
 * cannot resolve renders its own error notice rather than guessing.
 * @param kind - the shortcut kind the file's own extension selected.
 * @param text - the file's raw (JSON) content.
 * @returns the resolved shortcut, or `null` when the content is not a recognizable one.
 */
export function parseGoogleShortcut(kind: GoogleShortcutKind, text: string): GoogleShortcut | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>

  const url = stringField(record, 'url')
  const resolved = fromUrl(url)
    ?? fromResourceId(stringField(record, 'resource_id'))
    ?? (stringField(record, 'doc_id') !== undefined ? { fileId: stringField(record, 'doc_id') as string, docType: null } : null)
  if (resolved === null || !FILE_ID_PATTERN.test(resolved.fileId)) return null

  const docType = resolved.docType ?? DOC_TYPE_BY_KIND[kind]
  const fileId = resolved.fileId
  return {
    docType,
    fileId,
    editUrl: url ?? `https://docs.google.com/${docType}/d/${fileId}/edit`,
    // Always built fresh, never taken from the file's own `url`: Google
    // serves `/preview` specifically for third-party embedding (the same
    // endpoint Gmail's and Classroom's own attachment viewers use) —
    // substituting it for whatever path segment the shortcut's `url` field
    // happened to carry (`/edit`, `/view`, `/open`) is what makes the doc
    // viewable inside this app's iframe at all.
    previewUrl: `https://docs.google.com/${docType}/d/${fileId}/preview`,
  }
}
