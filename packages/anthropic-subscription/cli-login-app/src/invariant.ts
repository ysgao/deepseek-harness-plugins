/** Package-owned invariant companion. @module dsh-plugins-cli-login-app/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-plugins-cli-login-app'

/** Cordis companion plugin name. */
export const name = 'dsh-plugins-cli-login-app-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the authorization seam owns flow registration and
 * attempt lifecycle events; this package only drives one attempt over a
 * terminal interaction.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
