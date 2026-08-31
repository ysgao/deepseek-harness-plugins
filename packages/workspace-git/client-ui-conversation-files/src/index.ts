/**
 * The File conversation-view tab: in-app preview, edit, and side-by-side
 * git diff for a session's opened workspace paths. Registers into the
 * pristine `conversation.view` slot alongside Chat and Trajectory — see
 * `./apply.ts` for why this package needs no upstream diff, unlike its
 * sibling `dsh-plugins-client-ui-workspace-files`.
 * @module dsh-plugins-client-ui-conversation-files
 */
export { apply, inject } from './apply.ts'
export { FileView } from './FileView.tsx'
export type { FileViewInjected, FileViewProps } from './FileView.tsx'
export type { ConversationFilesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'conversation-files': import('./locales.ts').ConversationFilesKey
  }
}
