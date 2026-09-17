/**
 * Standalone MCP connector CLI: `dsh --profile mcp <command>`.
 *
 * Built for an agent first and a human second. An agent that has just been
 * told "connect my Gmail" can run `add`, then `login`, then `list --json`,
 * and read machine-parsable output at every step — which is why every command
 * takes `--json`, why `list --json` prints one object with no prose around
 * it, and why a refusal exits non-zero with its reason on stderr rather than
 * asking a follow-up question. The one genuinely interactive command,
 * `login`, is interactive only because OAuth consent is: a human has to
 * approve it in a browser, and no flag can change that.
 *
 * Its own dedicated profile plugin rather than a subcommand of
 * `@deepseek-ai/dsh-headless`, for the reason `dsh-plugins-cli-login-app`
 * documents at length: `dsh-cmdline` lets any number of plugins parse the
 * same argument line independently, and `dsh-headless/startup`'s variadic
 * `[task...]` catch-all has no grammar that rejects `add gmail --url ...`, so
 * composing these commands beside it would fire BOTH — a real headless task
 * run using `add` as its literal prompt, racing the actual connector write. A
 * profile with no task-positional parser mounted has no such ambiguity.
 *
 * @module dsh-plugins-cli-mcp-connector/cli
 */

import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { Command, Option } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction } from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { McpConnectorDefinition, McpConnectorEntry, McpConnectorTransport } from 'dsh-plugins-mcp-connector-registry/types'
// Side-effect type import: declaration-merges `ctx.mcpConnectors` onto Context.
import type {} from 'dsh-plugins-mcp-connector-registry'

/** Stable Cordis plugin name. */
export const name = 'mcp-connector-cli'

/** Services required before any command can run. */
export const inject = ['mcpConnectors', 'cmdlineArgs']

/** Process-facing effects this runner reads and writes; tests substitute captures. */
export const internals: {
  stdin: NodeJS.ReadableStream
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
} = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Every transport `add` accepts, in the order its help lists them. */
const TRANSPORTS: readonly McpConnectorTransport[] = ['streamable-http-oauth', 'streamable-http', 'stdio']

/** Repeatable `KEY=VALUE` option accumulator. */
function collectPair(raw: string, previous: Record<string, string>): Record<string, string> {
  const at = raw.indexOf('=')
  if (at <= 0) throw new Error(`expected KEY=VALUE, received "${raw}"`)
  return { ...previous, [raw.slice(0, at)]: raw.slice(at + 1) }
}

/** Repeatable plain-value accumulator. */
function collectValue(raw: string, previous: string[]): string[] {
  return [...previous, raw]
}

/** Print one JSON document, newline-terminated, for a caller piping to `jq`. */
function printJson(value: unknown): void {
  internals.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`)
}

/** One connector rendered for a human reading a terminal. */
function renderEntry(entry: McpConnectorEntry): string {
  const { definition: d } = entry
  const target = d.transport === 'stdio' ? `${d.command ?? ''} ${(d.args ?? []).join(' ')}`.trim() : d.url ?? ''
  const lines = [
    `${d.id}${d.label === '' || d.label === d.id ? '' : ` (${d.label})`}`,
    `  transport  ${d.transport}`,
    `  target     ${target}`,
    `  state      ${entry.health}${entry.error === undefined ? '' : ` — ${entry.error}`}`,
    `  tools      ${entry.tools.length === 0 ? 'none' : `${String(entry.tools.length)} (${entry.tools.join(', ')})`}`,
  ]
  if (entry.oauth !== undefined) {
    const o = entry.oauth
    lines.push(`  client     ${o.clientConfigured ? o.clientId ?? 'configured' : 'not configured'}`)
    lines.push(
      `  signed in  ${
        o.authorized
          ? `yes${o.renewable ? ' (renews automatically)' : ' (no refresh token — will need signing in again)'}${
            o.expiresAt === undefined ? '' : `, token expires ${new Date(o.expiresAt).toISOString()}`
          }`
          : 'no'
      }`,
    )
  }
  return lines.join('\n')
}

/**
 * Build the terminal half of one sign-in attempt: notices print to stdout,
 * and each prompt reads one line from stdin. An empty answer reads as the
 * human declining, mirroring a closed browser tab; a prompt's own `signal`
 * firing — this flow retires the paste prompt the moment the browser redirect
 * lands — is left to reject on its own, since that is not a decline.
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
          `  ${String(index + 1)}. ${option.label}${option.description === undefined ? '' : ` — ${option.description}`}`)
          .join('\n')}\n> `
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

/** Options every `add`/`set` invocation may carry. */
interface DefinitionOptions {
  transport: McpConnectorTransport
  label?: string
  url?: string
  command?: string
  arg: string[]
  env: Record<string, string>
  cwd?: string
  header: Record<string, string>
  scope?: string
  redirectUri?: string
  clientId?: string
  clientSecret?: string
  timeout?: string
  disabled?: boolean
  json?: boolean
}

/** Project CLI options into a stored definition. */
function toDefinition(id: string, options: DefinitionOptions, previous?: McpConnectorDefinition): McpConnectorDefinition {
  return {
    ...previous,
    id,
    label: options.label ?? previous?.label ?? '',
    enabled: options.disabled === true ? false : previous?.enabled ?? true,
    transport: options.transport,
    ...options.command === undefined ? {} : { command: options.command },
    ...options.arg.length === 0 ? {} : { args: options.arg },
    ...Object.keys(options.env).length === 0 ? {} : { env: options.env },
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    ...options.url === undefined ? {} : { url: options.url },
    ...Object.keys(options.header).length === 0 ? {} : { headers: options.header },
    ...options.redirectUri === undefined ? {} : { redirectUri: options.redirectUri },
    ...options.scope === undefined ? {} : { scope: options.scope },
    ...options.timeout === undefined ? {} : { toolCallTimeoutMs: Number.parseInt(options.timeout, 10) },
  }
}

/** Add the shared definition options to a command. */
function withDefinitionOptions(command: Command): Command {
  return command
    .addOption(
      new Option('--transport <transport>', 'which transport the server speaks')
        .choices([...TRANSPORTS])
        .default('streamable-http-oauth'),
    )
    .option('--label <label>', 'human-facing name; defaults to the id')
    .option('--url <url>', 'MCP endpoint URL (both streamable-http transports)')
    .option('--command <command>', 'executable to start (stdio)')
    .option('--arg <value>', 'one argument for --command; repeatable (stdio)', collectValue, [])
    .option('--env <KEY=VALUE>', 'one extra env var; repeatable (stdio)', collectPair, {})
    .option('--cwd <dir>', 'working directory for --command (stdio)')
    .option('--header <KEY=VALUE>', 'one extra HTTP header; repeatable', collectPair, {})
    .option('--scope <scope>', 'OAuth scopes to request; omit to use the server\'s published scopes_supported')
    .option('--redirect-uri <uri>', 'OAuth redirect URI registered with the client')
    .option('--client-id <id>', 'OAuth client id, stored in the credential record')
    .option('--client-secret <secret>', 'OAuth client secret, stored in the credential record')
    .option('--timeout <ms>', 'timeout per tool call in milliseconds')
    .option('--disabled', 'store the connector without mounting it')
    .option('--json', 'print the resulting connector as JSON')
}

/**
 * This app's commands.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function mcpCommand(): Command {
  const program = new Command()
    .name('dsh --profile mcp')
    .description('List, add, edit, and authorize MCP connectors for this dsh installation.')
    .helpOption('-h, --help', 'show this help')

  program.command('list')
    .description('list every configured connector')
    .option('--json', 'print as JSON')

  withDefinitionOptions(program.command('add'))
    .description('add a connector, or replace one already configured under the same id')
    .argument('<id>', 'stable connector id; its tools publish as mcp__<id>__<tool>')

  withDefinitionOptions(program.command('set'))
    .description('change fields of a configured connector, leaving the rest')
    .argument('<id>', 'the connector to change')

  program.command('remove')
    .description('remove a connector, and forget its stored authorization')
    .argument('<id>', 'the connector to remove')
    .option('--keep-authorization', 'leave the stored OAuth grant behind')
    .option('--json', 'print as JSON')

  program.command('login')
    .description('sign in to an OAuth connector, and exit once it settles')
    .argument('<id>', 'the connector to authorize')

  program.command('logout')
    .description('forget a connector\'s stored authorization, leaving its definition')
    .argument('<id>', 'the connector to sign out')
    .option('--json', 'print as JSON')

  program.command('status')
    .description('show one connector')
    .argument('<id>', 'the connector to describe')
    .option('--json', 'print as JSON')

  program.addHelpText('after', `
Examples:
  # Google's official Gmail MCP server. Google publishes no OAuth Dynamic
  # Client Registration endpoint, so a client id and secret registered in a
  # Google Cloud project are required; the scopes come from the server's own
  # RFC 9728 metadata, so --scope is usually unnecessary.
  dsh --profile mcp add gmail --url https://gmailmcp.googleapis.com/mcp/v1 \\
      --client-id <id>.apps.googleusercontent.com --client-secret <secret>
  dsh --profile mcp login gmail

  # Google Drive, same shape.
  dsh --profile mcp add drive --url https://drivemcp.googleapis.com/mcp/v1 \\
      --client-id <id>.apps.googleusercontent.com --client-secret <secret>
  dsh --profile mcp login drive

  # A local stdio server, no authorization involved.
  dsh --profile mcp add memory --transport stdio \\
      --command npx --arg -y --arg @modelcontextprotocol/server-memory

  # A remote server behind a static token.
  dsh --profile mcp add internal --transport streamable-http \\
      --url https://mcp.example.com/mcp --header "Authorization=Bearer \\$TOKEN"

  dsh --profile mcp list --json
`)
  return program
}

/**
 * Run one command against the connector registry and request process exit.
 * @param ctx - plugin context carrying `ctx.mcpConnectors` and the launcher's exit request.
 * @param run - the command body; its resolved value, when defined, is printed as JSON on `--json`.
 * @param json - whether the caller asked for machine-readable output.
 */
async function execute(
  ctx: Context,
  run: (registry: Context['mcpConnectors']) => Promise<unknown>,
  json: boolean,
): Promise<void> {
  await ctx.get('loader')?.await()
  const registry = ctx.get('mcpConnectors')
  const exit = ctx.get('appExit')
  // Early process shutdown can dispose the tree while a command is pending.
  if (registry === undefined || exit === undefined) return
  try {
    const result = await run(registry)
    if (json && result !== undefined) printJson(result)
    exit(0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (json) printJson({ ok: false, error: message })
    else internals.stderr.write(`dsh: ${message}\n`)
    exit(1)
  }
}

/**
 * Mount the connector CLI: parse the command line and run one command.
 * @param ctx - plugin context carrying `ctx.mcpConnectors`, `ctx.cmdlineArgs`, and `ctx.appExit`.
 */
export function apply(ctx: Context): void {
  const program = mcpCommand()

  program.commands.find(command => command.name() === 'list')?.action((options: { json?: boolean }) => {
    void execute(ctx, async (registry) => {
      const entries = await registry.list()
      if (options.json === true) return { ok: true, connectors: entries }
      if (entries.length === 0) internals.stdout.write('No MCP connectors are configured.\n')
      else internals.stdout.write(`${entries.map(renderEntry).join('\n\n')}\n`)
      return undefined
    }, options.json === true)
  })

  for (const verb of ['add', 'set'] as const) {
    program.commands.find(command => command.name() === verb)?.action((id: string, options: DefinitionOptions) => {
      void execute(ctx, async (registry) => {
        const previous = verb === 'set' ? (await registry.get(id)).definition : undefined
        await registry.put(toDefinition(id, options, previous))
        if (options.clientId !== undefined) {
          await registry.setClientCredentials(id, options.clientId, options.clientSecret)
        }
        const entry = await registry.get(id)
        if (options.json === true) return { ok: true, connector: entry }
        internals.stdout.write(`${renderEntry(entry)}\n`)
        if (entry.oauth !== undefined && !entry.oauth.authorized) {
          internals.stdout.write(`\nSign in with: dsh --profile mcp login ${id}\n`)
        }
        return undefined
      }, options.json === true)
    })
  }

  program.commands.find(command => command.name() === 'remove')
    ?.action((id: string, options: { keepAuthorization?: boolean; json?: boolean }) => {
      void execute(ctx, async (registry) => {
        await registry.remove(id, options.keepAuthorization !== true)
        if (options.json === true) return { ok: true, removed: id }
        internals.stdout.write(`Removed "${id}".\n`)
        return undefined
      }, options.json === true)
    })

  program.commands.find(command => command.name() === 'logout')?.action((id: string, options: { json?: boolean }) => {
    void execute(ctx, async (registry) => {
      await registry.signOut(id)
      if (options.json === true) return { ok: true, signedOut: id }
      internals.stdout.write(`Forgot the stored authorization for "${id}".\n`)
      return undefined
    }, options.json === true)
  })

  program.commands.find(command => command.name() === 'status')?.action((id: string, options: { json?: boolean }) => {
    void execute(ctx, async (registry) => {
      const entry = await registry.get(id)
      if (options.json === true) return { ok: true, connector: entry }
      internals.stdout.write(`${renderEntry(entry)}\n`)
      return undefined
    }, options.json === true)
  })

  program.commands.find(command => command.name() === 'login')?.action((id: string) => {
    void execute(ctx, async (registry) => {
      const authorization = ctx.get('authorization')
      if (authorization === undefined) {
        throw new Error('no authorization seam is mounted in this profile, so an OAuth connector cannot be signed in')
      }
      const entry = await registry.get(id)
      if (entry.definition.transport !== 'streamable-http-oauth') {
        throw new Error(`connector "${id}" is ${entry.definition.transport} and needs no sign-in`)
      }
      if (entry.oauth?.clientConfigured !== true) {
        throw new Error(
          `connector "${id}" has no OAuth client id yet — set one with: `
          + `dsh --profile mcp set ${id} --client-id <id> --client-secret <secret>`,
        )
      }
      const outcome = await authorization.begin({
        key: parseCredentialKey(registry.authorizationKey(id)),
        interaction: buildTerminalInteraction(),
      })
      if (outcome.status === 'cancelled') throw new Error(`sign-in for "${id}" was declined`)
      internals.stdout.write(`Signed in to "${id}".\n`)
      return undefined
    }, false)
  })

  parseCmdline(ctx, program)
}
