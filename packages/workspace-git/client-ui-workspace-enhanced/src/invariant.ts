/** Package-owned invariant companion. @module dsh-plugins-client-ui-workspace-enhanced/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-plugins-client-ui-workspace-enhanced'

/** Cordis companion plugin name. */
export const name = 'dsh-plugins-client-ui-workspace-enhanced-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package's only Cordis-owned state mirrors the
 * original `dsh-client-ui-workspace` plugin's own (slot registrations, a
 * locale dictionary) — effects the framework itself already governs. The
 * one addition, resolving the optional `workspaceFilesNode` service, is a
 * stateless `ctx.get()` read with no invariant of its own.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
