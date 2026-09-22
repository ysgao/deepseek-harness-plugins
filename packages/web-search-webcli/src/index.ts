/**
 * `web-cli`-backed `WebSearchProvider` plugin. It contributes to the `ctx.web` registry without
 * owning the service. Unlike a Google Programmable Search Engine (CSE) provider, `web-cli
 * websearch` is NOT restricted to a fixed site/domain list — it chains three engines ("google",
 * "bing", "gemini") over the open web (see `./provider.ts`'s doc comment).
 *
 * @module dsh-web-search-webcli
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  WebCliSearchProvider,
  WEBCLI_DEFAULT_COMMAND,
  WEBCLI_DEFAULT_ENGINE,
  WEBCLI_DEFAULT_TIMEOUT_MS,
} from './provider.ts'

export {
  WEBCLI_DEFAULT_COMMAND,
  WEBCLI_DEFAULT_ENGINE,
  WEBCLI_DEFAULT_TIMEOUT_MS,
  WEBCLI_PROVIDER_ID,
  WebCliSearchProvider,
  mapWebCliHit,
  mapWebCliResult,
  resolveWebCliCommand,
} from './provider.ts'
export type { WebCliSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-webcli'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Environment variable overriding the `web-cli` binary name/path. */
const DEFAULT_COMMAND_ENV = 'WEBCLI_COMMAND'

/** Environment variable overriding the default `websearch` engine. */
const DEFAULT_ENGINE_ENV = 'WEBCLI_ENGINE'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** `web-cli` binary name or path. Falls back to `$WEBCLI_COMMAND`, then `"web-cli"`. */
  command?: string
  /** `websearch` engine: `"google"` (default), `"bing"`, or `"gemini"`. Falls back to `$WEBCLI_ENGINE`. */
  engine?: 'google' | 'bing' | 'gemini'
  /** Default result count when a request carries no `maxResults`. Omitted = web-cli's own default (10). */
  maxResults?: number
  /** Subprocess timeout in milliseconds before a call is killed and reported as failed. Defaults to 120000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  command: z.string(),
  engine: z.union(['google', 'bing', 'gemini'] as const),
  maxResults: z.number().step(1).min(1),
  timeoutMs: z.number().step(1).min(1),
})

/** Register the web-cli search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const env = launchEnvironmentOf(ctx)
  const engine = config.engine ?? (env.get(DEFAULT_ENGINE_ENV)?.value as Config['engine'] | undefined) ?? WEBCLI_DEFAULT_ENGINE
  ctx.web.registerSearchProvider(new WebCliSearchProvider({
    command: config.command ?? env.get(DEFAULT_COMMAND_ENV)?.value ?? WEBCLI_DEFAULT_COMMAND,
    pathEnv: env.get('PATH')?.value ?? process.env.PATH,
    engine,
    timeoutMs: config.timeoutMs ?? WEBCLI_DEFAULT_TIMEOUT_MS,
    ...config.maxResults !== undefined ? { maxResults: config.maxResults } : {},
  }))
}
