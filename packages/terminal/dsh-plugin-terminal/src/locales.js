/**
 * `terminal-panel` locale namespace, registered via ctx.locale.register in
 * client-entry.js. Added by this fork — upstream hardcoded every UI string
 * in Simplified Chinese with no locale awareness at all, unlike every other
 * client package in this monorepo (see this package's README.md).
 */

/** English dictionary (the key-set source of truth: every key used by client-main.js's t() calls). */
export const en = {
  'terminal-panel.title': 'Terminal',
  'terminal-panel.titleWithCount': 'Terminal · {count}',
  'terminal-panel.noActiveSession': 'No active session',
  'terminal-panel.idle': 'Idle',
  'terminal-panel.starting': 'Starting…',
  'terminal-panel.sessionExitedHint': '{name} exited, click ⟳ to restart',
  'terminal-panel.dragResize': 'Drag to resize',
  'terminal-panel.tabTitleExited': '{name} (exited)',
  'terminal-panel.closeTab': 'Close {name}',
  'terminal-panel.newTerminal': 'New terminal',
  'terminal-panel.restartCurrentSession': 'Restart current session',
  'terminal-panel.restartProcessKeepSlot': 'Restart process (keeps tab slot)',
  'terminal-panel.collapsePanel': 'Collapse panel',
  'terminal-panel.collapsePanelHint': 'Collapse panel (Ctrl+`)',
  'terminal-panel.noTerminalSession': 'No terminal session',
  'terminal-panel.terminalPanelHint': 'Terminal panel (Ctrl+` to toggle)',
};

/** Simplified Chinese dictionary — the original upstream UI text, now opt-in via locale instead of unconditional. */
export const zh = {
  'terminal-panel.title': '终端',
  'terminal-panel.titleWithCount': '终端 · {count}',
  'terminal-panel.noActiveSession': '无会话',
  'terminal-panel.idle': '空闲',
  'terminal-panel.starting': '启动中…',
  'terminal-panel.sessionExitedHint': '{name} 已退出，点 ⟳ 重启',
  'terminal-panel.dragResize': '拖动调整高度',
  'terminal-panel.tabTitleExited': '{name}（已退出）',
  'terminal-panel.closeTab': '关闭 {name}',
  'terminal-panel.newTerminal': '新建终端',
  'terminal-panel.restartCurrentSession': '重启当前会话',
  'terminal-panel.restartProcessKeepSlot': '重启进程（保留标签位）',
  'terminal-panel.collapsePanel': '收起面板',
  'terminal-panel.collapsePanelHint': '收起面板（Ctrl+`）',
  'terminal-panel.noTerminalSession': '没有终端会话',
  'terminal-panel.terminalPanelHint': '终端面板（Ctrl+` 切换）',
};
