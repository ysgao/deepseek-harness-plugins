/**
 * In-app "editor" for a Google Drive shortcut file (`.gdoc`/`.gsheet`/
 * `.gslides`): there is no local text to edit — the shortcut carries only a
 * file id, not the document's own content — so Edit mode here means
 * Google's real editor, opened inline through its own `/edit` page in an
 * iframe that fills the whole pane.
 *
 * No split view, unlike `FileEditor`'s own buffer-plus-preview layout. A
 * text kind's Edit mode needs a second pane because the editing surface
 * (raw markup/plain text) and the reader-facing rendering of it are
 * genuinely different views of the same content; Google's `/edit` page
 * already **is** the fully rendered, reader-facing document — editing IS
 * previewing here, so a second read-only pane beside it would show the
 * same thing twice. `GoogleDocPreview`'s `/preview` iframe stays View
 * mode's own body, reached through the ordinary View/Edit toggle.
 *
 * Nothing here is saved through this app's own autosave/version-guard
 * pipeline (see `dsh-plugins-client-ui-conversation-files`'s `FileView`): an
 * edit made in the embedded Google editor is already persisted by Google
 * the moment it happens, the same as using docs.google.com directly in an
 * ordinary browser tab — this component owns no draft state, calls no
 * `onChange`, and reports no changes upward. The shortcut file itself (the
 * small JSON this app reads) never changes as a result of editing the real
 * document, so there is nothing for this app to write back either.
 *
 * `sandbox` (`GOOGLE_IFRAME_SANDBOX`) keeps a sign-in redirect from
 * hijacking this app's own tab, and the "open in a new tab" link beside the
 * frame is what a reader uses instead when one is actually needed — see
 * that constant's own doc comment for why both exist together. This is the
 * pane where a reader is most likely to hit it: editing is the action that
 * requires Google to know who they are.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { GoogleLabels } from './GoogleDocPreview.tsx'
import { GOOGLE_IFRAME_SANDBOX, parseGoogleShortcut } from './googleShortcut.ts'
import type { GoogleShortcutKind } from './googleShortcut.ts'
import css from './GoogleDocEditor.module.css'

export interface GoogleDocEditorProps {
  /** Which shortcut kind the file's own extension selected. */
  kind: GoogleShortcutKind
  /** The shortcut file's own raw JSON text. */
  text: string
  /** Localized chrome, shared with `GoogleDocPreview`'s own View-mode body. */
  labels: GoogleLabels
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/**
 * Render Google's real editor for one shortcut file.
 * @param props - see {@link GoogleDocEditorProps}.
 * @returns the embedded editor, or an error notice for an unresolvable shortcut.
 */
export function GoogleDocEditor({ kind, text, labels, className }: GoogleDocEditorProps): ReactNode {
  const shortcut = useMemo(() => parseGoogleShortcut(kind, text), [kind, text])

  if (shortcut === null) {
    return <p className={css.notice} role="alert">{labels.invalid}</p>
  }

  const appName = labels.appName(kind)

  return (
    <div className={clsx(css.root, className)}>
      <div className={css.header}>
        <span className={css.appName}>{appName}</span>
        <a className={css.openLink} href={shortcut.editUrl} target="_blank" rel="noopener noreferrer">
          {labels.openInNewTab}
        </a>
      </div>
      <iframe className={css.frame} src={shortcut.editUrl} title={appName} sandbox={GOOGLE_IFRAME_SANDBOX} />
    </div>
  )
}
