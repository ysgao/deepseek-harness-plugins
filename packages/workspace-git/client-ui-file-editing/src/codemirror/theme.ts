/**
 * FileEditor's CodeMirror theme: colors resolve through the same `--dsw-*`
 * tokens `ReadBlock`/`SideBySideDiff` already use for the read-only file
 * surfaces, so the editing surface matches their light/dark appearance with
 * no separate theme plumbing.
 *
 * `.cm-content`'s padding and `.cm-line`'s line-height are pinned to the
 * exact values `ReadBlock.module.css` (`@deepseek-ai/dsh-client-ui-primitives`,
 * vendored, not editable here) hardcodes for its own `.body`/`.line` rules
 * (`padding: 12px 0` and `--dsl-read-line-height: 22px`) — that CSS Module
 * scopes both as private, non-exported values (the custom property lives on
 * ReadBlock's own root, invisible to a sibling subtree like this editor
 * pane), so there is no shared token to reference; both sides must instead
 * hold this literal duplicate. Without it, `FileEditor`'s split preview
 * pane (`../FileEditor.module.css`'s `.previewPane`, which renders this same
 * file's text through `ReadBlock`) would not have its rows land at the same
 * vertical offset as this editor pane's own rows, defeating the two panes'
 * whole purpose of reading as one side-by-side view of the same content.
 */

import { EditorView } from '@codemirror/view'

/** `FileEditor`'s CodeMirror theme extension; apply as one of the editor's `extensions`. */
export const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--dsw-alias-label-primary)',
    backgroundColor: 'var(--dsw-alias-markdown-code-block)',
    height: '100%',
  },
  '.cm-content': {
    font: 'var(--dsw-font-markdown-code-block)',
    caretColor: 'var(--dsw-alias-label-primary)',
    padding: '12px 0',
  },
  '.cm-line': {
    lineHeight: '22px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--dsw-alias-label-primary)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--dsw-alias-markdown-code-block-banner)',
    color: 'var(--dsw-alias-label-tertiary)',
    border: 'none',
  },
  '.cm-scroller': {
    font: 'var(--dsw-font-markdown-code-block)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})
