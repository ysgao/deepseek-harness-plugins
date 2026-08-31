/** Package-owned invariant companion. @module dsh-plugins-client-ui-conversation-files/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-plugins-client-ui-conversation-files'

/** Cordis companion plugin name. */
export const name = 'dsh-plugins-client-ui-conversation-files-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package's only Cordis-owned state is one
 * `ctx.slots.inject('conversation.view', ...)` registration and one
 * `ctx.locale.register(...)` dictionary — both effects the framework itself
 * already governs (registry disposal, single dictionary per namespace).
 * Every Remote call this package makes is stateless request/response
 * through `ctx.remote`, owned by the responding controller package, not
 * here.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
