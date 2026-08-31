/** Package-owned invariant companion. @module dsh-plugins-api-workspace-file-controller/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-plugins-api-workspace-file-controller'

/** Cordis companion plugin name. */
export const name = 'dsh-plugins-api-workspace-file-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the workspace registry owns workspace identity and
 * path resolution; this package only reads/writes the host filesystem under
 * an already-resolved workspace path and projects the result onto the wire.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
