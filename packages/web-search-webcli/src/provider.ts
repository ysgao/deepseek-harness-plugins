/**
 * `WebCliSearchProvider`: a `WebSearchProvider` (see `@deepseek-ai/dsh-web`) backed by the
 * locally installed `web-cli websearch` command (see `@ysgao/web-cli`). Unlike a Google
 * Programmable Search Engine (CSE) provider, `web-cli websearch` is NOT restricted to a fixed
 * site/domain list: it chains three engines — "google" (a real automation-Chrome hit against
 * www.google.com/search, no API key/billing) -> "bing" (HTML scrape, no API key/billing) ->
 * "gemini" (needs GEMINI_API_KEY/GOOGLE_API_KEY, grounded synthesis) — so a query can still
 * return something usable even when the default engine's own attempt fails.
 *
 * `web-cli websearch` always prints ONE JSON object to stdout on success:
 *   `{ query, engine, fallback?: [{from, reason}], answer?: string, hits?: [{title, url, snippet?}] }`
 * and ONE JSON object to stderr on failure: `{ error: string, code: string }` (see web-cli's own
 * `src/index.ts` `printSuccess`/`printError`). This provider parses exactly that contract —
 * nothing fancier — and maps it onto the seam's normalized `WebSearchResult`.
 *
 * @module dsh-web-search-webcli/provider
 */

import { execFile } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { delimiter as pathDelimiter, isAbsolute, join } from 'node:path'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const WEBCLI_PROVIDER_ID = 'webcli'

/** Default binary name/path; resolved against `$PATH` when not absolute/relative. */
export const WEBCLI_DEFAULT_COMMAND = 'web-cli'

/** Default engine handed to `web-cli websearch --engine <engine>`. */
export const WEBCLI_DEFAULT_ENGINE = 'google'

/** Default per-call timeout (ms) before the subprocess is killed and the call fails. */
export const WEBCLI_DEFAULT_TIMEOUT_MS = 120_000

/** One failed step in web-cli's own engine fallback chain, as reported in its JSON envelope. */
interface WebCliFallbackStep {
  readonly from: string
  readonly reason: string
}

/** One hit in `web-cli websearch`'s `hits[]` (the "google"/"bing" engines). */
interface WebCliHit {
  readonly title?: string
  readonly url?: string
  readonly snippet?: string
}

/** The full JSON envelope `web-cli websearch` prints to stdout on success. */
interface WebCliSearchPayload {
  readonly query: string
  readonly engine: string
  readonly fallback?: readonly WebCliFallbackStep[]
  readonly answer?: string
  readonly hits?: readonly WebCliHit[]
}

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface WebCliSearchProviderOptions {
  /** Binary name or path. Bare name is resolved against `pathEnv` like a shell would. */
  readonly command: string
  /** `$PATH`-shaped string used to resolve a bare `command`. Normally `process.env.PATH`. */
  readonly pathEnv: string | undefined
  /** Engine sent as `--engine`: `"google"` (default), `"bing"`, or `"gemini"`. */
  readonly engine: 'google' | 'bing' | 'gemini'
  /** Default `--maxResults` when a request carries no `maxResults` of its own. */
  readonly maxResults?: number
  /** Subprocess timeout (ms) before the call is killed and reported as failed. */
  readonly timeoutMs: number
}

/**
 * Resolve `command` to an executable path for a CHEAP, synchronous, no-network usability check
 * (the `available()` contract on `WebSearchProvider` forbids network calls — it says nothing
 * about a local filesystem stat, which is what this does).
 *
 * - An absolute/relative path (contains a path separator) is checked directly with `accessSync`.
 * - A bare command name is resolved by walking `$PATH` the same way a shell would, checking each
 *   candidate with `accessSync(..., X_OK)`.
 *
 * @param command - configured binary name or path.
 * @param pathEnv - `$PATH`-shaped string to search when `command` is a bare name.
 * @returns the resolved absolute path, or `undefined` when no executable was found.
 */
export function resolveWebCliCommand(command: string, pathEnv: string | undefined): string | undefined {
  if (command.includes('/') || isAbsolute(command)) {
    try {
      accessSync(command, fsConstants.X_OK)
      return command
    } catch {
      return undefined
    }
  }
  const dirs = (pathEnv ?? '').split(pathDelimiter).filter(dir => dir.length > 0)
  for (const dir of dirs) {
    const candidate = join(dir, command)
    try {
      accessSync(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // not in this PATH entry — keep looking
    }
  }
  return undefined
}

/** True for a `child_process`/`AbortSignal` abort (matches the seam's cancellation contract). */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Parse `web-cli`'s own stderr JSON error envelope (`{error, code}`); falls back to the raw
 * stderr text when it isn't valid JSON (e.g. a crash before the CLI's top-level catch could
 * format one) so a real failure reason is never silently dropped in favor of a generic
 * "non-zero exit" message.
 *
 * @param stderr - the subprocess's captured stderr.
 * @returns a human-readable message describing the failure.
 */
function describeWebCliFailure(stderr: string): string {
  const trimmed = stderr.trim()
  if (trimmed.length === 0) return 'web-cli exited with no error output'
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; code?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      const code = typeof parsed.code === 'string' && parsed.code.length > 0 ? ` (${parsed.code})` : ''
      return `${parsed.error}${code}`
    }
  } catch {
    // not JSON — fall through to the raw text below
  }
  return trimmed
}

/**
 * Map one `web-cli websearch` hit to a normalized source, or `undefined` when it lacks a usable
 * `title`/`url` (the seam requires `url`; a hit missing either is dropped rather than emitted
 * half-formed, matching every other provider in this seam).
 *
 * @param hit - one entry of the payload's `hits[]`.
 * @returns the normalized source, or `undefined` when `title`/`url` are missing/blank.
 */
export function mapWebCliHit(hit: WebCliHit): WebSearchSource | undefined {
  if (hit.url === undefined || hit.url.length === 0) return undefined
  if (hit.title === undefined || hit.title.length === 0) return undefined
  return {
    url: hit.url,
    title: hit.title,
    ...hit.snippet !== undefined && hit.snippet.trim().length > 0 ? { snippet: hit.snippet } : {},
  }
}

/**
 * Map a `web-cli websearch` JSON envelope to a normalized `WebSearchResult`.
 *
 * - `hits[]` (the "google"/"bing" engines) become `sources[]` ({@link mapWebCliHit}).
 * - `answer` (the "gemini" engine) becomes `content`; `sources` stays `[]` since Gemini's
 *   grounded answer carries no per-source citation list of its own.
 * - `fallback[]`, when present, is prefixed onto `content` as a short human-readable note — the
 *   caller asked for the configured `engine` but a DIFFERENT engine actually answered only when
 *   this is present, and silently hiding that would misrepresent which engine's result this is.
 *
 * @param payload - the parsed `websearch` stdout JSON.
 * @returns the normalized result; `truncated` is always `false` (the seam enforces `maxResults`).
 */
export function mapWebCliResult(payload: WebCliSearchPayload): WebSearchResult {
  const sources = (payload.hits ?? [])
    .map(mapWebCliHit)
    .filter((source): source is WebSearchSource => source !== undefined)

  const fallbackNote = payload.fallback !== undefined && payload.fallback.length > 0
    ? `[web-cli fell back from ${payload.fallback.map(step => `${step.from} (${step.reason})`).join(' -> ')} to ${payload.engine}]\n\n`
    : ''

  const answer = payload.answer ?? ''
  const content = fallbackNote.length > 0 || answer.length > 0 ? `${fallbackNote}${answer}`.trim() : ''

  return {
    ...content.length > 0 ? { content } : {},
    sources,
    truncated: false,
  }
}

/**
 * The `web-cli`-backed search provider. `available()` only checks that the configured binary
 * resolves on disk; `search()` shells out to `web-cli websearch <query> --engine <engine>
 * --maxResults <n>` and parses its JSON stdout contract.
 */
export class WebCliSearchProvider implements WebSearchProvider {
  readonly id = WEBCLI_PROVIDER_ID

  constructor(private readonly options: WebCliSearchProviderOptions) {}

  available(): boolean {
    return resolveWebCliCommand(this.options.command, this.options.pathEnv) !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const resolved = resolveWebCliCommand(this.options.command, this.options.pathEnv)
    if (resolved === undefined) {
      throw new WebError(
        `web-cli command "${this.options.command}" was not found on $PATH — is @ysgao/web-cli installed?`,
        'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }

    const args = ['websearch', request.query, '--engine', this.options.engine]
    const maxResults = request.maxResults ?? this.options.maxResults
    if (maxResults !== undefined) args.push('--maxResults', String(maxResults))

    let stdout: string
    try {
      stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          resolved,
          args,
          { timeout: this.options.timeoutMs, maxBuffer: 16 * 1024 * 1024, ...signal !== undefined ? { signal } : {} },
          (error, out, errOut) => {
            if (error) {
              reject(Object.assign(error, { stderr: errOut }))
              return
            }
            resolve(out)
          },
        )
      })
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new WebError('web-cli websearch aborted', 'WEB_ABORTED', { cause: error })
      }
      const stderr = error instanceof Error && 'stderr' in error && typeof (error as { stderr?: unknown }).stderr === 'string'
        ? (error as { stderr: string }).stderr
        : ''
      const message = describeWebCliFailure(stderr)
      throw new WebError(`web-cli websearch failed: ${message}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    let payload: WebCliSearchPayload
    try {
      payload = JSON.parse(stdout) as WebCliSearchPayload
    } catch (error: unknown) {
      throw new WebError(
        `web-cli websearch returned an unparsable response: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    return mapWebCliResult(payload)
  }
}
