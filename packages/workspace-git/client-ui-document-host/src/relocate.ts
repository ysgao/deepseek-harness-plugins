/**
 * Move one registration, keep the whole engine.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`'s `apply()` performs a
 * dozen registrations: a tab type, dictionaries, a service, a seat, a chip
 * title, one body per format, and — as of `0.2.3-alpha.3` — a second,
 * unrelated tab kind (`compaction-summary`, a transient Markdown view opened
 * from a compaction row) that happens to share the SAME `sidebar.right.pane.tab`
 * parent slot the file-preview body hangs off. Exactly one of those
 * registrations decides *where the file preview engine draws* — the body
 * keyed `TEXTPREVIEW_ID`. Every renderer hangs off THAT entry's own children
 * table, so moving it moves all of them, including renderers upstream has
 * not written yet. The compaction summary is not one of them: it has no file
 * to show in the File tab, and vendor's own code never routes it there.
 *
 * So this does not fork, mirror or enumerate the renderers. It calls the
 * vendor's own `apply()` with a Context whose `slots` face rewrites ONE
 * entry's target slot — matched by key, not merely by slot name, now that a
 * second entry shares the name — and passes everything else through
 * untouched. The alternative — re-registering each body under a parallel slot
 * family — works identically today and silently omits whatever the next
 * release adds, which is the failure mode this repo exists to avoid.
 * @module dsh-plugins-client-ui-document-host/relocate
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TEXTPREVIEW_ID } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/definition.ts'

/** The right-Sidebar seat the vendor plugin registers its preview into. */
export const VENDOR_SEAT = 'sidebar.right.pane.tab'

/** The File-tab seat it is relocated onto (see `./contract.ts`). */
export const FILE_TAB_SEAT = 'conversation.file.document'

/** The `ctx.slots` surface this shim has to stand in for, structurally. */
interface SlotsFace {
  register: (options: { name: string; key?: string }, component: unknown) => () => void
  inject: (name: string, run: () => unknown) => () => void
  [key: string]: unknown
}

/**
 * Wrap a Context so the preview engine's file-document seat registration
 * lands in the File tab instead of the right Sidebar.
 *
 * The wrapper forwards every property read to the real Context with the real
 * Context as the receiver, so service resolution, effect scoping and fiber
 * identity stay exactly as they would be if the vendor plugin had been
 * activated directly — this is a redirect, not a sandbox.
 * @param ctx - this plugin's own Context.
 * @returns a Context to hand to the vendor `apply()`.
 */
export function relocatingContext(ctx: Context): Context {
  const slots = ctx.slots as unknown as SlotsFace
  const relocated: SlotsFace = Object.create(slots) as SlotsFace
  // Only `register` is touched; every other member of the slots face,
  // `inject` included, is inherited above, so a method added upstream keeps
  // working without a change here.
  relocated.register = (options, component) => {
    // Keyed by TEXTPREVIEW_ID, not merely by slot name: `sidebar.right.pane.tab`
    // is a `keyed` slot that now holds a second, unrelated entry (the
    // compaction-summary body, added upstream alongside the file preview).
    // Redirecting on name alone would catch both and collide them inside the
    // File tab's `single` seat — "single slot already has a registration".
    // Only the file-preview body is this package's business; anything else
    // registered under this shared slot name stays exactly where the vendor
    // plugin put it.
    if (options.name !== VENDOR_SEAT || options.key !== TEXTPREVIEW_ID) return slots.register(options, component)
    // The key goes with the slot: the Sidebar seat is keyed because it
    // dispatches among tab types, the File tab's seat is `single` because it
    // shows one file. Carrying a key into a single slot is a registration
    // error, not a harmless extra.
    const { key: _key, ...rest } = options
    // The File tab's seat may not be declared yet — ordering between this
    // plugin and `dsh-plugins-client-ui-conversation-files` (the package that
    // declares it) is not guaranteed, and `register()` throws for an
    // undeclared slot. `slots.inject` (left untouched above, so it still
    // waits on whatever name it is given) stands in here for the wait that
    // redirecting the vendor's own `ctx.slots.inject(VENDOR_SEAT, …)` call
    // used to provide, back when this was the only entry under that slot.
    return slots.inject(FILE_TAB_SEAT, () => slots.register({ ...rest, name: FILE_TAB_SEAT }, component))
  }
  return new Proxy(ctx, {
    get(target, property) {
      if (property === 'slots') return relocated
      // Read AND call against the real Context, never against this wrapper:
      // `ctx` is itself a Cordis proxy over a fiber, and a method invoked
      // with the wrapper as `this` would reach for that fiber's own private
      // state through the wrong object. Binding here keeps `ctx.effect(...)`
      // and friends running on the fiber that actually owns them, so the
      // vendor plugin's effects are disposed with this plugin exactly as its
      // own would have been.
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}
