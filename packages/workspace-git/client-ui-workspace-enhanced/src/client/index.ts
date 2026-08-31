/**
 * Browser-only entry: enhanced replacement for `dsh-client-ui-workspace`'s
 * own browser/picker plugin. See `../apply.ts` for the full rationale.
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
 * @module dsh-plugins-client-ui-workspace-enhanced/client
 */
export { apply, inject } from '../apply.ts'
export { EnhancedWorkspaceBrowser } from '../WorkspaceBrowser.tsx'
export type { EnhancedWorkspaceBrowserProps } from '../WorkspaceBrowser.tsx'
