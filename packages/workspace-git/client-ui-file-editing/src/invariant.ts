/** Package-owned invariant companion. @module dsh-plugins-client-ui-file-editing/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-plugins-client-ui-file-editing'

/** Cordis companion plugin name. */
export const name = 'dsh-plugins-client-ui-file-editing-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: pure props-in React atoms with no Cordis API —
 * no events, no services, no mutable cross-plugin state.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
