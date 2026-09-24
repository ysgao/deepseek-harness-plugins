/**
 * Move one registration, keep the whole engine.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`'s `apply()` performs a
 * dozen registrations: a tab type, two dictionaries, a service, a seat, a
 * chip title, and one body per format. Exactly one of them decides *where*
 * the engine draws — the seat it registers into `sidebar.right.pane.tab`.
 * Every renderer hangs off that seat's own children table, so moving the
 * seat moves all of them, including renderers upstream has not written yet.
 *
 * So this does not fork, mirror or enumerate anything. It calls the vendor's
 * own `apply()` with a Context whose `slots` face rewrites that single
 * registration's target slot, and passes everything else through untouched.
 * The alternative — re-registering each body under a parallel slot family —
 * works identically today and silently omits whatever the next release adds,
 * which is the failure mode this repo exists to avoid.
 * @module dsh-plugins-client-ui-document-host/relocate
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

/** The right-Sidebar seat the vendor plugin registers its preview into. */
export const VENDOR_SEAT = 'sidebar.right.pane.tab'

/** The File-tab seat it is relocated onto (see `./contract.ts`). */
export const FILE_TAB_SEAT = 'conversation.file.document'

/** The `ctx.slots` surface this shim has to stand in for, structurally. */
interface SlotsFace {
  register: (options: { name: string; key?: string }, component: unknown) => () => void
  inject: (name: string, run: () => unknown) => unknown
  [key: string]: unknown
}

/**
 * Wrap a Context so the preview engine's seat registration lands in the File
 * tab instead of the right Sidebar.
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
  // `register` and `inject` are the only two the redirect touches; every
  // other member of the slots face is inherited above, so a method added
  // upstream keeps working without a change here.
  relocated.register = (options, component) => {
    if (options.name !== VENDOR_SEAT) return slots.register(options, component)
    // The key goes with the slot: the Sidebar seat is keyed because it
    // dispatches among tab types, the File tab's seat is `single` because it
    // shows one file. Carrying a key into a single slot is a registration
    // error, not a harmless extra.
    const { key: _key, ...rest } = options
    return slots.register({ ...rest, name: FILE_TAB_SEAT }, component)
  }
  relocated.inject = (name, run) => slots.inject(name === VENDOR_SEAT ? FILE_TAB_SEAT : name, run)
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
