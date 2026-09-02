/**
 * In-app text editor for a File tab: a CodeMirror 6 buffer, with a live
 * read-only preview pane alongside it whenever one adds reader-facing value
 * over the plain editing surface — Markdown (`kind: 'markdown'`, rendered
 * through `MarkdownText`) and any `kind: 'text'` file whose extension
 * resolves a shiki grammar hint (`lang`, rendered through the app's one
 * syntax highlighter, `ReadBlock` — the same component `FilePreview`'s own
 * View mode already uses, so Edit and View highlight identically). A
 * `kind: 'text'` file with no resolved `lang` (e.g. `.txt`, `.log`) has
 * nothing highlighting would add, so it keeps the single plain-monospace
 * pane. Deliberately uncontrolled after mount — `text`/`kind` seed the
 * initial buffer only; a caller wanting a fresh buffer for a different file
 * remounts by keying on the file's path (CodeMirror, not React, then owns
 * the buffer, undo history, and cursor/selection for that file's lifetime).
 * Every change reports upward through `onChange`; save/dirty/error chrome
 * is the caller's concern.
 *
 * The editing surface itself stays undecorated monospace regardless of
 * `lang` — no per-language CodeMirror grammar — since the preview pane
 * already covers highlighting; only Markdown additionally gets
 * structure-aware editing (`@codemirror/lang-markdown`, for list/blockquote
 * continuation), a genuinely editing-time behavior a read-only preview pane
 * can't substitute for.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { MarkdownText, ReadBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { editorTheme } from './codemirror/theme.ts'
import { toReadBlockLines } from './FilePreview.tsx'
import type { FilePreviewLabels } from './FilePreview.tsx'
import { useSplitRatio } from './useSplitRatio.ts'
import css from './FileEditor.module.css'

/** `--ds-file-editor-ratio` holds a unitless number read back by {@link FileEditor.module.css}'s `calc()` column widths. */
type SplitRootStyle = CSSProperties & { '--ds-file-editor-ratio': number }

/** Debounce between a keystroke and the preview pane (Markdown or syntax-highlighted text) re-rendering it. */
const PREVIEW_DEBOUNCE_MS = 150

/** The preview pane's resize divider: accessible name and drag/double-click hint. */
export interface FileEditorResizeLabels {
  /** The divider's `aria-label`. */
  ariaLabel: string
  /** The divider's `title` (drag/double-click hint). */
  title: string
}

export interface FileEditorProps {
  /** Display path; read by the `kind: 'text'` preview pane's `ReadBlock` banner label. */
  path: string
  /** Initial buffer content — read once, at mount, then owned by CodeMirror. */
  text: string
  /** `'markdown'` adds Markdown-aware editing; both kinds may additionally show a live preview pane — see `lang`. */
  kind: 'text' | 'markdown'
  /** shiki grammar hint for a `kind: 'text'` file's preview pane; unused for `kind: 'markdown'`. Absent (unrecognized extension) skips the split view — a single plain-monospace pane, as `kind: 'text'` always was before this hint existed. */
  lang?: string | undefined
  /** Localized chrome for whichever preview pane renders (Markdown or syntax-highlighted text). */
  labels: FilePreviewLabels
  /** The preview-pane resize divider's accessible name and hint; unused when no preview pane renders. */
  resizeLabels: FileEditorResizeLabels
  /** Called with the full buffer content after every edit. */
  onChange: (text: string) => void
  /**
   * Bound to Cmd/Ctrl+S while the editor has focus (suppresses the browser's
   * own save-page dialog); omitted leaves the shortcut unhandled here.
   */
  onSaveRequested?: () => void
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/**
 * Render the CodeMirror buffer, plus its live preview pane when one applies
 * (Markdown, or a `kind: 'text'` file with a resolved `lang`).
 * @param props - see {@link FileEditorProps}.
 * @returns the editor element.
 */
export function FileEditor({ path, text, kind, lang, labels, resizeLabels, onChange, onSaveRequested, className }: FileEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRequestedRef = useRef(onSaveRequested)
  onSaveRequestedRef.current = onSaveRequested
  // Markdown always gets a live preview; a 'text' file only when its
  // extension resolved a grammar hint — an unrecognized extension has
  // nothing highlighting would add over the plain editing pane itself.
  const hasPreview = kind === 'markdown' || lang !== undefined
  const [previewText, setPreviewText] = useState(hasPreview ? text : '')
  const { ratio, dividerProps } = useSplitRatio()

  useEffect(() => {
    const host = hostRef.current
    /* v8 ignore next */
    if (host === null) return
    let previewTimer: number | undefined
    const extensions = [
      lineNumbers(),
      history(),
      keymap.of([
        { key: 'Mod-s', run: () => { onSaveRequestedRef.current?.(); return true } },
        indentWithTab,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.lineWrapping,
      editorTheme,
      ...(kind === 'markdown' ? [markdown()] : []),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        const next = update.state.doc.toString()
        onChangeRef.current(next)
        if (hasPreview) {
          window.clearTimeout(previewTimer)
          previewTimer = window.setTimeout(() => { setPreviewText(next) }, PREVIEW_DEBOUNCE_MS)
        }
      }),
    ]
    const view = new EditorView({ state: EditorState.create({ doc: text, extensions }), parent: host })
    return () => {
      window.clearTimeout(previewTimer)
      view.destroy()
    }
    // Mount-once: `text`/`kind`/`lang`/`hasPreview` seed the initial buffer
    // and preview posture only (see the component doc comment) — CodeMirror
    // owns the document from here, and a caller wanting a different
    // `lang`/`kind` remounts by keying on the file's path, same as `text`.
  }, [])

  const previewLines = useMemo(
    () => kind === 'text' ? toReadBlockLines(previewText) : [],
    [kind, previewText],
  )

  const splitStyle: SplitRootStyle | undefined = hasPreview
    ? { '--ds-file-editor-ratio': ratio }
    : undefined

  return (
    <div
      className={clsx(hasPreview ? css.splitRoot : css.root, className)}
      style={splitStyle}
    >
      <div className={css.editorPane} ref={hostRef} />
      {hasPreview && (
        <>
          <div
            className={css.divider}
            role="separator"
            aria-orientation="vertical"
            aria-label={resizeLabels.ariaLabel}
            tabIndex={0}
            title={resizeLabels.title}
            {...dividerProps}
          />
          <div className={css.previewPane}>
            {kind === 'markdown'
              ? <MarkdownText text={previewText} labels={labels.markdown} />
              : (
                <ReadBlock
                  label={path}
                  lines={previewLines}
                  totalLines={previewLines.length}
                  lang={lang}
                  labels={labels.read}
                />
              )}
          </div>
        </>
      )}
    </div>
  )
}
