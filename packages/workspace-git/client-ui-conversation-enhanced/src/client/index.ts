/**
 * Browser-only entry: enhanced replacement for `dsh-client-ui-conversation`'s
 * own conversation-shell plugin. See `../apply.ts` for the full rationale.
 *
 * Kept under `./client`, separate from the package's default `.` export
 * (`../index.ts`, a Host-safe no-op): this module transitively imports
 * `dsh-client-ui-primitives` CSS Modules (through the reused `ConversationRoot`/
 * `InputBar`/queue and settings skeletons), which a plain Node ESM import
 * cannot resolve (`ERR_UNKNOWN_FILE_EXTENSION`) — only a browser bundle's
 * CSS-modules-inline transform handles them. The Host Loader imports every
 * entry's DEFAULT export during composition (even for a Client-face row);
 * only the browser-side loader (`packages/client/web`, vendored) ever
 * resolves `./client` — discovered through this package's own `dsh.client`
 * declaration, the same pattern pristine `dsh-client-ui-conversation` uses.
 * @module dsh-plugins-client-ui-conversation-enhanced/client
 */
export { apply, inject, type EnhancedConversationSessionInjected } from '../apply.ts'
export { ConversationSession, type EnhancedConversationSessionProps } from '../ConversationSession.tsx'
export type { ConversationFileOpener } from '../service.ts'
export type { PendingFileOpen } from '../FileOpenRegistry.ts'
