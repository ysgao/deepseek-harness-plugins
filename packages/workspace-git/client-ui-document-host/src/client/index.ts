/**
 * The preview engine, relocated: upstream's own document renderers drawing
 * in the conversation's File tab instead of the right Sidebar.
 *
 * This package replaces the `ui-sidebar-documentpreview` row — see
 * `../../../../ARCHITECTURE.md`'s "Document preview: relocate the seat,
 * never the renderers" — and is a superset of it by construction rather
 * than by inventory: it runs that plugin's own `apply()`, so every tab type,
 * dictionary, service, seat, chip title and renderer it registers is
 * registered here too, including ones added in a later release. One
 * registration is redirected (`../relocate.ts`) and two are added:
 *
 * - the File tab's document seat now carries the engine, answering
 *   `useTabInfo()` from the tab's own state (that seat is declared by
 *   `dsh-plugins-client-ui-conversation-files`, the package that draws it;
 *   this one only registers into it, by name);
 * - the right-Sidebar body for a file address hands that address to the File
 *   tab and closes (`../HandoffBody.tsx`), so `openResource` — which throws
 *   for an unclaimed address — keeps working for conversation file links,
 *   tool line references, and this bundle's own Files tree.
 *
 * Kept under `./client`, separate from the package's Host-safe default
 * export, for the reason every Client package here is: the Host Loader
 * imports every row's `.` export during composition, and this module's
 * graph is full of CSS Modules that only a browser bundle can resolve.
 * @module dsh-plugins-client-ui-document-host/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the Context merges this plugin's own body reads — copy (ctx.locale)
// and the slot registry (ctx.slots). The engine's apply() pulls the rest.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
// Type-only: pulls the optional conversationFileOpener Context merge.
import type {} from 'dsh-plugins-client-ui-conversation-enhanced/client'
import {
  apply as applyDocumentPreview,
  inject as documentPreviewInject,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/index.ts'
import { TEXTPREVIEW_ID } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/definition.ts'
import { relocatingContext, VENDOR_SEAT } from '../relocate.ts'
import { HandoffBody, type HandoffInjected } from '../HandoffBody.tsx'
import { registerHostRenderers } from '../renderers.tsx'
import { en, zh } from '../locales.ts'
import type { DocumentHostKey } from '../locales.ts'

export type { DocumentHostKey } from '../locales.ts'
export { FILE_TAB_SEAT, VENDOR_SEAT } from '../relocate.ts'

/** This package's own copy namespace (the engine keeps every one of its own). */
const NS = 'document-host'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The hand-off refusal line. */
    'document-host': DocumentHostKey
  }
}

/**
 * Required Client services: the replaced row's own list, unchanged — this
 * plugin must refuse to activate wherever that row would have refused to.
 */
export const inject = [...documentPreviewInject]

/**
 * Register the relocated preview engine and its right-Sidebar hand-off.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  // The engine first: it declares the File-tab seat's children (the document
  // slots every renderer registers into), so nothing else here can run
  // before its registration exists.
  applyDocumentPreview(relocatingContext(ctx))

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'document-host: dictionaries')
  const t = ctx.locale.bind(NS)
  const injected: HandoffInjected = {
    handoff: (address) => {
      const file = parseFileAddress(address)
      if (file?.scope !== 'session') return false
      // The opener resolves the workspace from the session itself: a file
      // address carries the session that opened it, never a workspace id.
      return ctx.get('conversationFileOpener')?.openFile(file.sessionId as SessionId, file.path, undefined) ?? false
    },
    refusalLabel: () => t('handoff.unavailable'),
  }
  // Registered under the engine's own implementation id, into the seat the
  // engine's body just vacated: the `text` tab type still claims every
  // `dsh-resource://file/**` address, and this is what it now draws.
  ctx.effect(() => ctx.slots.inject(VENDOR_SEAT, () => ctx.slots.register(
    { name: VENDOR_SEAT, key: TEXTPREVIEW_ID, locale: NS, inject: (): HandoffInjected => injected },
    HandoffBody,
  )), 'document-host: file hand-off body')

  // The two formats the engine has no body for, contributed through its own
  // public registry. Last, because it reads `ctx.documentPreviews` — which
  // the engine's own apply() above is what provides.
  registerHostRenderers(ctx, NS)
}
