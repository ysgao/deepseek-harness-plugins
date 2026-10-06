/**
 * In-app "editor" for a Google Drive shortcut file (`.gdoc`/`.gsheet`/
 * `.gslides`): there is no local text to edit — the shortcut carries only a
 * file id, not the document's own content — so Edit mode here means
 * Google's real editor, opened inline through its own `/edit` page in an
 * iframe, with the same read-only `/preview` iframe View mode shows
 * (`./GoogleDocPreview.tsx`) kept alongside it. Mirrors `FileEditor`'s own
 * split-pane shape exactly — a draggable `useSplitRatio` divider between an
 * editing surface and a live preview — so switching Edit on for a text file
 * and for a Google file in the same File tab feels like the same feature,
 * not two different ones: the same Edit button, the same split layout, just
 * a different pair of panes inside it.
 *
 * Nothing here is saved through this app's own autosave/version-guard
 * pipeline (see `dsh-plugins-client-ui-conversation-files`'s `FileView`): an
 * edit made in the embedded Google editor is already persisted by Google
 * the moment it happens, the same as using docs.google.com directly in an
 * ordinary browser tab — this component owns no draft state, calls no
 * `onChange`, and reports no changes upward. The shortcut file itself (the
 * small JSON this app reads) never changes as a result of editing the real
 * document, so there is nothing for this app to write back either.
 */
import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import clsx from 'clsx'
import type { GoogleLabels } from './GoogleDocPreview.tsx'
import { parseGoogleShortcut } from './googleShortcut.ts'
import type { GoogleShortcutKind } from './googleShortcut.ts'
import { useSplitRatio } from './useSplitRatio.ts'
import css from './GoogleDocEditor.module.css'

/** `--ds-google-editor-ratio` holds a unitless number read back by `GoogleDocEditor.module.css`'s `calc()` column widths — same mechanism as `FileEditor`'s own `--ds-file-editor-ratio`. */
type SplitRootStyle = CSSProperties & { '--ds-google-editor-ratio': number }

/** The preview pane's resize divider: accessible name and drag/double-click hint — same shape as `FileEditorResizeLabels`, kept as its own type so this component has no import edge onto `FileEditor.tsx`. */
export interface GoogleDocEditorResizeLabels {
  /** The divider's `aria-label`. */
  ariaLabel: string
  /** The divider's `title` (drag/double-click hint). */
  title: string
}

export interface GoogleDocEditorProps {
  /** Which shortcut kind the file's own extension selected. */
  kind: GoogleShortcutKind
  /** The shortcut file's own raw JSON text. */
  text: string
  /** Localized chrome, shared with `GoogleDocPreview`'s own View-mode body. */
  labels: GoogleLabels
  /** The divider's accessible name and hint. */
  resizeLabels: GoogleDocEditorResizeLabels
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/**
 * Render the Google editor/preview split for one shortcut file.
 * @param props - see {@link GoogleDocEditorProps}.
 * @returns the split view, or an error notice for an unresolvable shortcut.
 */
export function GoogleDocEditor({ kind, text, labels, resizeLabels, className }: GoogleDocEditorProps): ReactNode {
  const shortcut = useMemo(() => parseGoogleShortcut(kind, text), [kind, text])
  const { ratio, dividerProps } = useSplitRatio()

  if (shortcut === null) {
    return <p className={css.notice} role="alert">{labels.invalid}</p>
  }

  const appName = labels.appName(kind)
  const splitStyle: SplitRootStyle = { '--ds-google-editor-ratio': ratio }

  return (
    <div className={clsx(css.splitRoot, className)} style={splitStyle}>
      <div className={css.pane}>
        <p className={css.paneLabel}>{appName}</p>
        <iframe className={css.frame} src={shortcut.editUrl} title={appName} />
      </div>
      <div
        className={css.divider}
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabels.ariaLabel}
        tabIndex={0}
        title={resizeLabels.title}
        {...dividerProps}
      />
      <div className={css.pane}>
        <p className={css.paneLabel}>{labels.previewPaneLabel}</p>
        <iframe className={css.frame} src={shortcut.previewUrl} title={labels.previewPaneLabel} />
      </div>
    </div>
  )
}
