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
  'files.viewer.docxTitle': '文档（文本）',
  'files.viewer.xlsxTitle': '表格（文本）',
  'files.viewer.pptxTitle': '演示文稿（文本）',
  'files.viewer.delimitedTitle': '表格（分隔符）',
  'files.viewer.xlsxEmpty': '此工作表没有内容',
  'files.viewer.xlsxTruncated': '仅显示前 {rows} 行 × {cols} 列（表格更大，其余部分未显示）',
  'files.viewer.pptxEmpty': '此演示文稿没有可提取的文本',
  'files.viewer.pptxSlide': '幻灯片 {index}',
  'files.viewer.delimitedEmpty': '此文件没有内容',
  'files.viewer.delimitedTruncated': '仅显示前 {rows} 行 × {cols} 列（文件更大，其余部分未显示）',
  'files.viewer.rtfEmpty': '此文档没有可提取的文本',
  'files.viewer.rtfTruncated': '仅显示前 {shown} 段（共 {total} 段）',
  'files.diff.view': '查看',
  'files.diff.diff': '差异',
  'files.diff.empty': '没有差异可显示',
  'files.diff.resizeAria': '调整列宽',
  'files.diff.resizeTitle': '拖动以调整大小，双击重置',
  'files.edit.edit': '编辑',
  'files.edit.saved': '已保存',
  'files.edit.saving': '保存中…',
  'files.edit.conflict': '文件已在磁盘上被修改，无法保存。',
  'files.edit.reload': '放弃更改并重新加载',
  'files.edit.saveError': '自动保存失败。',
  'files.edit.retry': '重试',
  'files.edit.unsaved': '有未保存的更改',
  'files.edit.resizeAria': '调整预览大小',
  'files.edit.resizeTitle': '拖动以调整大小，双击重置',
  'files.edit.aiPredictionOn': 'AI 预测：开',
  'files.edit.aiPredictionOff': 'AI 预测：关',
  'files.edit.aiPredictionOnHint': '已开启：使用本次对话所用的模型预测下一句。点击关闭。',
  'files.edit.aiPredictionOffHint': '已关闭：仍会提示本文件中重复出现的句子/行。点击开启模型预测。',
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
  'files.viewer.docxTitle': 'Document (text)',
  'files.viewer.xlsxTitle': 'Spreadsheet (text)',
  'files.viewer.pptxTitle': 'Presentation (text)',
  'files.viewer.delimitedTitle': 'Table (delimited)',
  'files.viewer.xlsxEmpty': 'This sheet has no content',
  'files.viewer.xlsxTruncated': 'Showing the first {rows} rows × {cols} columns (the sheet is larger; the rest is hidden)',
  'files.viewer.pptxEmpty': 'No extractable text in this presentation',
  'files.viewer.pptxSlide': 'Slide {index}',
  'files.viewer.delimitedEmpty': 'This file has no content',
  'files.viewer.delimitedTruncated': 'Showing the first {rows} rows × {cols} columns (the file is larger; the rest is hidden)',
  'files.viewer.rtfEmpty': 'No extractable text in this document',
  'files.viewer.rtfTruncated': 'Showing the first {shown} of {total} paragraphs',
  'files.diff.view': 'View',
  'files.diff.diff': 'Diff',
  'files.diff.empty': 'No differences to show',
  'files.diff.resizeAria': 'Resize columns',
  'files.diff.resizeTitle': 'Drag to resize, double-click to reset',
  'files.edit.edit': 'Edit',
  'files.edit.saved': 'Saved',
  'files.edit.saving': 'Saving…',
  'files.edit.conflict': 'This file changed on disk and can’t be saved.',
  'files.edit.reload': 'Discard changes and reload',
  'files.edit.saveError': 'Autosave failed.',
  'files.edit.retry': 'Retry',
  'files.edit.unsaved': 'Unsaved changes',
  'files.edit.resizeAria': 'Resize preview',
  'files.edit.resizeTitle': 'Drag to resize, double-click to reset',
  'files.edit.aiPredictionOn': 'AI predictions: On',
  'files.edit.aiPredictionOff': 'AI predictions: Off',
  'files.edit.aiPredictionOnHint': 'On: predicts the next sentence using this conversation’s own model. Click to turn off.',
  'files.edit.aiPredictionOffHint': 'Off: still suggests sentences/lines already repeated in this file. Click to turn on model predictions.',
} satisfies Record<ConversationFilesKey, string>
