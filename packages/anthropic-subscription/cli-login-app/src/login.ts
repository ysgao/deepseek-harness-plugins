/**
 * Standalone CLI login runner: `dsh --profile <name> <credential-key>` runs
 * one `ctx.authorization` attempt over a terminal interaction and exits.
 *
 * This is intentionally its own dedicated profile plugin rather than a
 * `login` subcommand added to `@deepseek-ai/dsh-headless`: `dsh-cmdline`
 * lets any number of plugins read the same argument line, but each program
 * parses independently — `@deepseek-ai/dsh-headless/startup`'s own
 * `[task...]` argument is a variadic catch-all with no grammar that would
 * reject `login llm-pi-ai/anthropic`, so composing a `login` command
 * alongside it would fire BOTH actions on the same invocation (a real
 * headless task run using the credential key as its literal prompt, racing
 * the real login flow). A dedicated profile with no task-positional parser
 * mounted has no such ambiguity, and the module doc for `dsh-cmdline` (see
 * `packages/boot/cmdline/README.md`) explicitly supports apps built outside
 * this repository parsing their own command line this way.
 *
 * @module dsh-plugins-cli-login-app/login
 */

import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { AuthorizationInteraction } from '@deepseek-ai/dsh-authorization'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'

/** Stable Cordis plugin name. */
export const name = 'cli-login-runner'

/** Services required before an attempt can run. */
export const inject = ['authorization', 'cmdlineArgs']

/** Process-facing effects this runner reads and writes; tests substitute captures. */
export const internals: { stdin: NodeJS.ReadableStream; stdout: { write(chunk: string): unknown }; stderr: { write(chunk: string): unknown } } = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

/**
 * This app's command: the credential key positional, its optional method
 * flag, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function loginCommand(): Command {
  return new Command()
    .name('dsh --profile <name>')
    .description('Authorize one credential through its registered ctx.authorization flow, and exit.')
    .helpOption('-h, --help', 'show this help')
    .argument('<key>', 'the credential key to authorize, as "<scope>/<id>" — for example: llm-pi-ai/anthropic')
    .option('--method <method>', 'which of the flow\'s methods to run; omit to use its first')
    .addHelpText('after', `
Examples:
  dsh --profile anthropic llm-pi-ai/anthropic     authorize the Anthropic subscription flow and exit
`)
}

/**
 * Build the terminal half of one authorization attempt: notices print to
 * stdout, and each prompt reads one line from stdin. An empty answer reads as
 * the human declining, mirroring a closed browser tab; a prompt's own
 * `signal` firing (a flow retiring the losing side of a race) is left to
 * reject on its own, since that is not a decline.
 * @returns the interaction handed to `ctx.authorization.begin()`.
 */
function buildTerminalInteraction(): AuthorizationInteraction {
  return {
    notify(notice) {
      internals.stdout.write(`${notice.message}\n`)
      if (notice.url !== undefined) internals.stdout.write(`  ${notice.url}\n`)
      if (notice.code !== undefined) internals.stdout.write(`  Code: ${notice.code}\n`)
    },
    async prompt(prompt) {
      const question = prompt.kind === 'select'
        ? `${prompt.message}\n${prompt.options.map((option, index) =>
          `  ${index + 1}. ${option.label}${option.description === undefined ? '' : ` — ${option.description}`}`).join('\n')}\n> `
        : `${prompt.message}${prompt.placeholder === undefined ? '' : ` (${prompt.placeholder})`} `
      internals.stdout.write(question)
      const rl = createInterface({ input: internals.stdin })
      try {
        // readline's 'line' event always carries exactly one string argument.
        const [answer] = await once(rl, 'line', prompt.signal === undefined ? {} : { signal: prompt.signal }) as [string]
        if (answer.trim() === '') throw new AuthorizationDeclinedError()
        if (prompt.kind !== 'select') return answer
        const chosen = prompt.options[Number.parseInt(answer, 10) - 1]
        if (chosen === undefined) throw new AuthorizationDeclinedError(`"${answer}" is not one of the offered options`)
        return chosen.id
      } finally {
        rl.close()
      }
    },
  }
}

/**
 * Run one credential authorization through its registered flow, over a
 * terminal interaction, and request process exit.
 * @param ctx - plugin context carrying `ctx.authorization` and the launcher's exit request.
 * @param key - the credential key to authorize.
 * @param method - which of the flow's methods to run; `undefined` defers to its first.
 */
async function runLogin(ctx: Context, key: CredentialKey, method: string | undefined): Promise<void> {
  await ctx.get('loader')?.await()
  const authorization = ctx.get('authorization')
  const exit = ctx.get('appExit')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (authorization === undefined || exit === undefined) return
  try {
    const outcome = await authorization.begin({
      key,
      interaction: buildTerminalInteraction(),
      ...method === undefined ? {} : { method },
    })
    if (outcome.status === 'cancelled') {
      internals.stderr.write(`dsh: sign-in for "${key}" was declined\n`)
      exit(1)
      return
    }
    internals.stdout.write(`Signed in for "${key}".\n`)
    internals.stdout.write(
      'If its route is not already configured, add it under the owning adapter\'s settings section (for example,'
      + ' `providers.anthropic: {}` under `llm-pi-ai:` in $DSH_HOME/settings.yaml) to make it selectable.\n',
    )
    exit(0)
  } catch (error) {
    internals.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  }
}

/**
 * Mount the login-only CLI: parse the credential key positional and run one
 * authorization attempt.
 * @param ctx - plugin context carrying `ctx.authorization`, `ctx.cmdlineArgs`, and `ctx.appExit`.
 */
export function apply(ctx: Context): void {
  const program = loginCommand()
  program.action((rawKey: string, options: { method?: string }) => {
    let key: CredentialKey
    try {
      key = parseCredentialKey(rawKey)
    } catch {
      program.error(`error: "${rawKey}" is not a valid credential key; expected "<scope>/<id>", for example: llm-pi-ai/anthropic`)
      return
    }
    void runLogin(ctx, key, options.method)
  })
  parseCmdline(ctx, program)
}
