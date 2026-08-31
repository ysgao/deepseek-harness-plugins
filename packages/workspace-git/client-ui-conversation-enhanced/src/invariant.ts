/** Package-owned invariant companion. @module dsh-plugins-client-ui-conversation-enhanced/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-plugins-client-ui-conversation-enhanced'

/** Cordis companion plugin name. */
export const name = 'dsh-plugins-client-ui-conversation-enhanced-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package's Cordis-owned state mirrors the
 * original `dsh-client-ui-conversation` plugin's own (slot registrations,
 * store instances, locale dictionaries) — effects the framework itself
 * already governs. The one addition, `FileOpenRegistry`, is a plain
 * per-session request queue with no cross-package relationship to assert.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
