/** Package-owned invariant companion. @module dsh-plugins-api-authorization-controller/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-plugins-api-authorization-controller'

/** Cordis companion plugin name. */
export const name = 'dsh-plugins-api-authorization-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the authorization seam owns flow registration and
 * attempt lifecycle events; this package only projects its methods onto the wire.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
