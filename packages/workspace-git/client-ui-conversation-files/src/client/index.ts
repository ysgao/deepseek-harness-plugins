/**
 * Browser-only entry: the File conversation-view tab. Registers into the
 * pristine `conversation.view` slot alongside Chat and Trajectory — see
 * `../apply.ts` for why this package needs no upstream diff, unlike its
 * sibling `dsh-plugins-client-ui-workspace-files`.
 *
 * Kept under `./client`, separate from the package's default `.` export
 * (`../index.ts`, a Host-safe no-op): this module transitively imports
 * `dsh-client-ui-primitives` CSS Modules, which a plain Node ESM import
 * cannot resolve (`ERR_UNKNOWN_FILE_EXTENSION`) — only a browser bundle's
 * CSS-modules-inline transform handles them. The Host Loader imports every
 * entry's DEFAULT export during composition (even for a Client-face row);
 * only the browser-side loader (`packages/client/web`, vendored) ever
 * resolves `./client` — discovered through this package's own `dsh.client`
 * declaration, the same pattern pristine `dsh-client-ui-workspace` uses.
 * @module dsh-plugins-client-ui-conversation-files/client
 */
export { apply, inject } from '../apply.ts'
export { FileView } from '../FileView.tsx'
export type { FileViewInjected, FileViewProps } from '../FileView.tsx'
export type { ConversationFilesKey } from '../locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'conversation-files': import('../locales.ts').ConversationFilesKey
  }
}
