/**
 * `conversation-files` namespace dictionaries: the File tab's own copy —
 * empty state, View/Edit/Diff toggle, save/conflict states, resize
 * handles. Ported verbatim from `yga/deepseek-harness`'s own direct edits
 * to `dsh-client-ui-conversation`'s `conversation` namespace (this
 * package's whole reason for existing: those edits moved here instead of
 * the vendored package). Kept as its own namespace, `files.` prefix
 * included, rather than merged into the pristine `conversation` dictionary
 * — unlike this file's neighbors (`copy`, `read.window`, `markdown.
 * footnotes`, …), which are already pristine `conversation`-namespace keys
 * `FileView.tsx` reads straight off the slot-injected `t`.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  /** The tab's own label — mirrors `ui-chat`'s `view.chat` / `ui-trajectory`'s `view.trajectory`, each in the owning package's own namespace. */
  'view.file': '文件',
  'files.empty': '尚未打开任何文件',
  'files.viewer.loading': '正在加载文件…',
  'files.viewer.loadError': '无法读取文件',
  'files.viewer.tooLarge': '文件过大，无法在应用内预览（{maxMB} MB 上限）',
  'files.viewer.openExternally': '用系统默认应用打开',
  'files.diff.view': '查看',
  'files.diff.diff': '差异',
  'files.diff.empty': '没有差异可显示',
  'files.diff.resizeAria': '调整列宽',
  'files.diff.resizeTitle': '拖动以调整大小，双击重置',
  'files.edit.edit': '编辑',
  'files.edit.save': '保存',
  'files.edit.saving': '保存中…',
  'files.edit.conflict': '文件已在磁盘上被修改，无法保存。',
  'files.edit.reload': '放弃更改并重新加载',
  'files.edit.saveError': '保存失败，请重试。',
  'files.edit.resizeAria': '调整预览大小',
  'files.edit.resizeTitle': '拖动以调整大小，双击重置',
} satisfies Record<string, string>

/** The `conversation-files` namespace key union. */
export type ConversationFilesKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'view.file': 'File',
  'files.empty': 'No file opened yet',
  'files.viewer.loading': 'Loading file…',
  'files.viewer.loadError': 'Couldn’t read this file',
  'files.viewer.tooLarge': 'File too large to preview in-app ({maxMB} MB limit)',
  'files.viewer.openExternally': 'Open with default app',
  'files.diff.view': 'View',
  'files.diff.diff': 'Diff',
  'files.diff.empty': 'No differences to show',
  'files.diff.resizeAria': 'Resize columns',
  'files.diff.resizeTitle': 'Drag to resize, double-click to reset',
  'files.edit.edit': 'Edit',
  'files.edit.save': 'Save',
  'files.edit.saving': 'Saving…',
  'files.edit.conflict': 'This file changed on disk and can’t be saved.',
  'files.edit.reload': 'Discard changes and reload',
  'files.edit.saveError': 'Save failed. Try again.',
  'files.edit.resizeAria': 'Resize preview',
  'files.edit.resizeTitle': 'Drag to resize, double-click to reset',
} satisfies Record<ConversationFilesKey, string>
