/**
 * Host loader entry for the document host — the one part of the replaced row
 * that is not browser code.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` has a Host half as
 * well as a browser one: it embeds the validated preview settings in the
 * page (`webserver/index-inject` pushes `__DSH_DOCUMENT_PREVIEW_CONFIG__`),
 * which is where the browser engine reads its cache limits from. Disabling
 * that row switches the Host half off too, so a no-op here would leave those
 * limits permanently at their schema defaults with no way to configure
 * them — a replacement registering strictly less than the row it replaced,
 * which is exactly what CONSTITUTION.md Article III forbids.
 *
 * So this delegates rather than reimplements: the vendor's own `apply` and
 * its own `Config` schema, re-exported unchanged, now keyed to this row.
 * Settings move with the row — a profile configures `document-host` where it
 * used to configure `ui-sidebar-documentpreview` — and the schema, the
 * defaults and the injected global stay whatever upstream says they are,
 * including after a pin bump.
 *
 * Importing it here is Host-safe: that module's graph is its config schema
 * and one event handler, with no CSS Module or browser API in it. The reason
 * every other Client package in this repo keeps its `.` export a no-op is in
 * `./client/index.ts`, and still applies to that half.
 * @module dsh-plugins-client-ui-document-host
 */

export { apply, Config } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'
