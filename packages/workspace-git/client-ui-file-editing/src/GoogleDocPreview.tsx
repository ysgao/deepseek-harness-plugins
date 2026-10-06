/**
 * Read-only View-mode body for a Google Drive shortcut file (`.gdoc`/
 * `.gsheet`/`.gslides`): Google's own `/preview` iframe for the file the
 * shortcut points at — a cross-origin-embeddable, read-only viewer Google
 * serves specifically for this (the same endpoint Gmail's and Classroom's
 * own attachment previews use), built from the id `./googleShortcut.ts`
 * resolves out of the shortcut's own JSON.
 *
 * There is no local document content to render — the shortcut carries only
 * enough to find the real thing on Google's servers — so unlike every other
 * body in this package, this one reads nothing from the file's own bytes
 * beyond that id. Edit mode uses a different body (`./GoogleDocEditor.tsx`),
 * with Google's real editor embedded instead of this read-only viewer.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { parseGoogleShortcut } from './googleShortcut.ts'
import type { GoogleShortcutKind } from './googleShortcut.ts'
import css from './GoogleDocPreview.module.css'

/** Localized chrome shared by this body and `GoogleDocEditor`'s own two panes. */
export interface GoogleLabels {
  /** "Google Docs"/"Google Sheets"/"Google Slides", given the shortcut's own kind — used as the iframe `title` here, and as the editing pane's heading plus its own iframe `title` in `GoogleDocEditor`. */
  appName: (kind: GoogleShortcutKind) => string
  /** The read-only pane's own heading in `GoogleDocEditor`; unused by this View-mode body, which has only the one pane. */
  previewPaneLabel: string
  /** Shown instead of the iframe when the shortcut's own content could not be resolved to a real file id. */
  invalid: string
}

export interface GoogleDocPreviewProps {
  /** Which shortcut kind the file's own extension selected. */
  kind: GoogleShortcutKind
  /** The shortcut file's own raw JSON text. */
  text: string
  labels: GoogleLabels
}

/**
 * Render one Google Drive shortcut file's read-only preview.
 * @param props - see {@link GoogleDocPreviewProps}.
 * @returns Google's own embedded preview, or an error notice for an unresolvable shortcut.
 */
export function GoogleDocPreview({ kind, text, labels }: GoogleDocPreviewProps): ReactNode {
  const shortcut = useMemo(() => parseGoogleShortcut(kind, text), [kind, text])
  if (shortcut === null) return <p className={css.notice} role="alert">{labels.invalid}</p>
  return <iframe className={css.frame} src={shortcut.previewUrl} title={labels.appName(kind)} />
}
