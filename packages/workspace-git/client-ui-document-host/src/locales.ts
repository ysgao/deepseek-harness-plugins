/**
 * This package's own `document-host` namespace. One key: the line the right
 * Sidebar shows when a file cannot be handed to the File tab.
 *
 * Deliberately not added to the vendored preview engine's own
 * `sidebarDocumentPreview` dictionary, which this package re-registers
 * unchanged by running that plugin's `apply()`: a key this repo owns living
 * in a namespace upstream owns is exactly the kind of thing a pin bump
 * silently clobbers.
 * @module dsh-plugins-client-ui-document-host/locales
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'handoff.unavailable': '无法在会话中打开此文件：当前没有可用的文件标签页。',
  'ontology.title': '本体',
  'rtf.title': 'RTF 文档',
  'rtf.truncated': '仅显示前 {shown} 段（共 {total} 段）',
  'rtf.empty': '此文档没有可提取的文本',
  'docx.title': '文档（文本）',
  'xlsx.title': '表格（文本）',
  'pptx.title': '演示文稿（文本）',
  'delimited.title': '表格（分隔符）',
  'text.loading': '正在解析…',
  'text.loadError': '无法读取此文件。',
  'xlsx.truncated': '仅显示前 {rows} 行 × {cols} 列',
  'xlsx.empty': '此工作簿没有可显示的单元格',
  'pptx.slide': '第 {index} 张幻灯片',
  'pptx.empty': '此演示文稿没有可提取的文本',
  'delimited.truncated': '仅显示前 {rows} 行 × {cols} 列',
  'delimited.empty': '此文件没有数据行',
  'renderer.codeLabel': '代码',
  'renderer.wrap': '自动换行',
  'renderer.unwrap': '取消自动换行',
  'renderer.window': '显示 {shown} / {total} 行',
  'renderer.copy': '复制',
  'renderer.copied': '已复制',
  'renderer.collapseAria': '折叠',
  'renderer.expandAria': '展开其余 {count} 行',
  'renderer.collapse': '折叠',
  'renderer.expandRest': '展开其余 {count} 行',
} satisfies Record<string, string>

/** The `document-host` namespace key union. */
export type DocumentHostKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'handoff.unavailable': 'This file can’t be opened here: no File tab is available in this session.',
  'ontology.title': 'Ontology',
  'rtf.title': 'RTF document',
  'rtf.truncated': 'Showing the first {shown} of {total} paragraphs',
  'rtf.empty': 'No extractable text in this document',
  'docx.title': 'Document (text)',
  'xlsx.title': 'Spreadsheet (text)',
  'pptx.title': 'Presentation (text)',
  'delimited.title': 'Table (delimited)',
  'text.loading': 'Parsing…',
  'text.loadError': 'This file could not be read.',
  'xlsx.truncated': 'Showing the first {rows} rows x {cols} columns',
  'xlsx.empty': 'No displayable cells in this workbook',
  'pptx.slide': 'Slide {index}',
  'pptx.empty': 'No extractable text in this presentation',
  'delimited.truncated': 'Showing the first {rows} rows x {cols} columns',
  'delimited.empty': 'No data rows in this file',
  'renderer.codeLabel': 'Code',
  'renderer.wrap': 'Wrap lines',
  'renderer.unwrap': 'Unwrap lines',
  'renderer.window': 'Showing {shown} of {total} lines',
  'renderer.copy': 'Copy',
  'renderer.copied': 'Copied',
  'renderer.collapseAria': 'Collapse',
  'renderer.expandAria': 'Expand the remaining {count} lines',
  'renderer.collapse': 'Collapse',
  'renderer.expandRest': 'Expand the remaining {count} lines',
} satisfies Record<DocumentHostKey, string>
