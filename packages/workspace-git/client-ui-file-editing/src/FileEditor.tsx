/**
 * In-app text editor for a File tab: a CodeMirror 6 buffer, with a live
 * read-only preview pane alongside it whenever one adds reader-facing value
 * over the plain editing surface. Every {@link FileTextKind} but `'text'`
 * always shows one, each deriving its body from the buffer itself with no
 * `lang` involved — Markdown through `MarkdownText`, an OWL/RDF ontology
 * through `OntologyPreview`, a `.csv`/`.tsv` as a live table through
 * `DelimitedPreview`, an `.rtf`'s extracted text through `RtfPreview` — so an
 * edit to the raw text is reflected in the rendered view a keystroke later.
 * A `kind: 'text'` file shows one only when its extension resolves a shiki
 * grammar hint (`lang`, rendered through the app's one syntax highlighter,
 * `ReadBlock` — the same component `FilePreview`'s own View mode already uses,
 * so Edit and View highlight identically); with no resolved `lang` (e.g.
 * `.txt`, `.log`, a `.key`) there is nothing highlighting would add, so it
 * keeps the single plain-monospace pane.
 * Deliberately uncontrolled after mount — `text`/`kind` seed the
 * initial buffer only; a caller wanting a fresh buffer for a different file
 * remounts by keying on that file's own identity (CodeMirror, not React,
 * then owns the buffer, undo history, and cursor/selection for that file's
 * lifetime) — `path` alone when a caller only ever addresses one namespace
 * of paths, or `path` combined with whatever else disambiguates two files
 * that can otherwise share a path (e.g. `dsh-plugins-client-ui-conversation-
 * files`'s `FileView` keys on `(workspaceId, path)`, since two different
 * Workspace groups can each have their own same-named file).
 * Every change reports upward through `onChange`; save/dirty/error chrome
 * is the caller's concern.
 *
 * The editing surface itself stays undecorated monospace regardless of
 * `lang` or `kind` — no per-language CodeMirror grammar, ontology
 * serializations and RTF markup included (CodeMirror publishes no grammar for
 * any of them either) — since the preview pane already covers highlighting;
 * only Markdown additionally gets structure-aware editing (`@codemirror/lang-markdown`, for
 * list/blockquote continuation), a genuinely editing-time behavior a read-only
 * preview pane can't substitute for. One decoration applies to every kind
 * alike: the buffer's content DOM carries `spellcheck="true"`, so the
 * browser's own native spellchecker underlines misspellings exactly as it
 * would in a plain `<textarea>` — the browser/OS dictionary, not a
 * code-aware one, so it has no notion of identifiers or per-language
 * comment/string scoping.
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
import { DelimitedPreview } from './DelimitedPreview.tsx'
import type { FilePreviewLabels, FileTextKind } from './FilePreview.tsx'
import { toReadBlockLines } from './lines.ts'
import { OntologyPreview } from './OntologyPreview.tsx'
import { RtfPreview } from './RtfPreview.tsx'
import { useSplitRatio } from './useSplitRatio.ts'
import css from './FileEditor.module.css'

/** `--ds-file-editor-ratio` holds a unitless number read back by {@link FileEditor.module.css}'s `calc()` column widths. */
type SplitRootStyle = CSSProperties & { '--ds-file-editor-ratio': number }

/** Debounce between a keystroke and the preview pane (Markdown or syntax-highlighted text) re-rendering it. */
const PREVIEW_DEBOUNCE_MS = 150

/**
 * `ReadBlock`'s own default (16) caps displayed lines with a collapse/expand
 * toggle in place of the rest — the right posture for a bounded chat-message
 * excerpt, its original use, but wrong for this pane: a live full-file
 * preview needs every line rendered so `.previewPane`'s own scroll container
 * (`FileEditor.module.css`) has real content to scroll, not a toggle hiding
 * it. `Infinity` keeps `ReadBlock`'s own "hidden > 0" cap check false
 * unconditionally, at any file length.
 */
const NO_MAX_LINES = Number.POSITIVE_INFINITY

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
  /** `'markdown'` adds Markdown-aware editing; every kind but `'text'` always previews (each derives its own body from the buffer, with no `lang` involved); a `'text'` file previews only when `lang` resolves — see `lang`. */
  kind: FileTextKind
  /** shiki grammar hint for a `kind: 'text'` file's preview pane; unused by every other kind, which derives its own body from the buffer. Absent (unrecognized extension) skips the split view — a single plain-monospace pane, as `kind: 'text'` always was before this hint existed. */
  lang?: string | undefined
  /** Localized chrome for whichever preview pane renders. */
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
  // Every kind but 'text' always gets a live preview: each derives its own
  // body from the buffer itself (Markdown structure, a detected ontology
  // serialization, a delimited file's columns, an RTF document's text), so
  // none of them needs a `lang`. A 'text' file previews only when its
  // extension resolved a grammar hint — an unrecognized extension has nothing
  // highlighting would add over the plain editing pane itself.
  const hasPreview = kind !== 'text' || lang !== undefined
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
      // Native browser spellcheck on the editable buffer: CodeMirror renders
      // its content DOM as `contenteditable`, so the browser's own
      // spellchecker (same mechanism as a plain `<textarea>`) activates the
      // moment that element carries `spellcheck="true"` — no CodeMirror
      // extension, dictionary, or Host round-trip involved. It's the
      // browser/OS dictionary, not a code-aware one (no camelCase/identifier
      // splitting), so false positives on code identifiers are expected; it
      // still gives every FileTextKind (prose and code alike) the same
      // squiggly-underline spelling feedback a plain text field already has
      // elsewhere in the app.
      EditorView.contentAttributes.of({ spellcheck: 'true' }),
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
    // `lang`/`kind` remounts by keying on the same file identity `text`
    // itself remounts on (see the component doc comment — not always bare `path`).
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
            {kind === 'markdown' && <MarkdownText text={previewText} labels={labels.markdown} />}
            {kind === 'ontology' && (
              <OntologyPreview path={path} text={previewText} labels={labels.read} maxLines={NO_MAX_LINES} />
            )}
            {kind === 'delimited' && (
              <DelimitedPreview
                path={path}
                text={previewText}
                truncatedLabel={labels.delimited.truncated}
                emptyLabel={labels.delimited.empty}
              />
            )}
            {kind === 'rtf' && (
              <RtfPreview
                text={previewText}
                truncatedLabel={labels.rtf.truncated}
                emptyLabel={labels.rtf.empty}
              />
            )}
            {kind === 'text' && (
              <ReadBlock
                label={path}
                lines={previewLines}
                totalLines={previewLines.length}
                lang={lang}
                labels={labels.read}
                maxLines={NO_MAX_LINES}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
