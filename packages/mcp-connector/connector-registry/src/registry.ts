/**
 * `ctx.mcpConnectors`: the durable list of MCP connectors, and the live
 * mounts that list produces.
 *
 * Two halves that are easy to confuse. The *definition* half is ordinary
 * configuration — an endpoint, a transport, a label — and lives in the
 * settings seam, where a configuration surface can read and write it and a
 * human can hand-edit the document. The *credential* half — the OAuth client
 * pair and the tokens — never touches that document; it lives in the
 * credential seam's record space, which is what that space is for. So a
 * settings document can be copied between machines without carrying anyone's
 * refresh token with it.
 *
 * The mount half is a reconciliation loop, not a startup list: a connector
 * added, edited, enabled, or removed at runtime takes effect immediately,
 * because `ctx.plugin()` is just as available at minute ten as at boot. That
 * is what makes both the Settings page and the CLI able to add a working MCP
 * server to a running `dsh` without a restart.
 *
 * @module dsh-plugins-mcp-connector-registry/registry
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as mcpClientOAuth from 'dsh-plugins-mcp-client-oauth'
import {
  assertConnectorIdUnfolded, connectorCredentialKey, grantedScopes, McpOAuthStore, portableGrant,
} from 'dsh-plugins-mcp-client-oauth'
import type { Config as McpClientConfig } from 'dsh-plugins-mcp-client-oauth'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {
  McpClonedAuthorization, McpConnectorDefinition, McpConnectorEntry, McpConnectorHealth,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The durable MCP connector list and its live mounts. */
    mcpConnectors: McpConnectorRegistry
  }
}

/** The settings section this registry owns. */
export interface McpConnectorSection {
  /** Every configured connector, in the order a surface should list them. */
  connectors: McpConnectorDefinition[]
}

/** A connector's `id` grammar, matching `mcp-client-oauth`'s own `serverName` pattern. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** The grammar of a name a child process can carry as an environment variable. */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One live mount. */
interface Mount {
  /** The config this mount was started with, for diffing against the next reconcile. */
  readonly signature: string
  /** The fiber running `dsh-plugins-mcp-client-oauth` for this connector. */
  readonly fiber: Fiber
  /** Why the mount failed at load, when it did. */
  error?: string
}

/**
 * Raised when a caller names a connector that is not configured. Separate
 * from a generic error so a wire layer can map it to a not-found rather than
 * an internal failure.
 */
export class McpConnectorNotFoundError extends Error {
  /** Stable machine code for a wire layer mapping this to its own taxonomy. */
  readonly code = 'MCP_CONNECTOR_NOT_FOUND'

  /** @param id - the connector nothing is configured for. */
  constructor(readonly id: string) {
    super(`mcp-connector: no connector named "${id}" is configured`)
    this.name = 'McpConnectorNotFoundError'
  }
}

/** Raised when a definition cannot be mounted as written. */
export class McpConnectorInvalidError extends Error {
  /** Stable machine code for a wire layer mapping this to its own taxonomy. */
  readonly code = 'MCP_CONNECTOR_INVALID'

  /** @param message - what is wrong with the definition. */
  constructor(message: string) {
    super(`mcp-connector: ${message}`)
    this.name = 'McpConnectorInvalidError'
  }
}

/**
 * Turn a failed sign-in into the message every surface shows.
 *
 * Lives here rather than in either surface because both must say the same
 * thing: the CLI raises it directly, and the Remote controller folds it into
 * the error the Settings page renders. A diagnosis worth writing once is worth
 * writing once.
 *
 * Which servers need an OAuth client registered by hand is not knowable before
 * the attempt. One that publishes an RFC 7591 `registration_endpoint` gets its
 * client during the attempt itself — Atlassian's MCP server is one of those —
 * so this is advice attached to a failure, never a pre-flight refusal, which
 * is what used to make every self-registering server unreachable.
 *
 * @param id - the connector that failed to sign in.
 * @param error - whatever the authorization attempt threw.
 * @param clientConfigured - whether a client was already stored for it.
 * @returns the message to report, unchanged when this diagnosis does not apply.
 */
export function signInFailure(id: string, error: unknown, clientConfigured: boolean): string {
  const message = error instanceof Error ? error.message : String(error)
  // Matches the MCP SDK's own wording for an authorization server with no
  // `registration_endpoint` ("Incompatible auth server: does not support
  // dynamic client registration"), which is exactly the case a hand-made
  // client answers. Google's is the one in front of us. Attaching this to any
  // other failure would send someone to a cloud console over a network blip.
  if (clientConfigured || !/dynamic client registration/i.test(message)) return message
  return `${message}. This server does not register a client for you, so "${id}" needs one by hand: `
    + `add an OAuth client id and secret in Settings > MCP connectors, or run `
    + `dsh --profile mcp set ${id} --client-id <id> --client-secret <secret>`
}

/**
 * Build the `dsh-plugins-mcp-client-oauth` config one definition mounts as.
 *
 * Every transport-specific field is validated here rather than by the plugin's
 * own Schemastery union, because a definition is one flat shape (see
 * {@link McpConnectorDefinition}) and the union would reject the inert fields
 * of whichever transport is not selected.
 *
 * @param definition - the stored definition.
 * @returns the plugin config to mount.
 * @throws {McpConnectorInvalidError} when a field the selected transport needs is missing.
 */
export function buildClientConfig(definition: McpConnectorDefinition): McpClientConfig {
  if (!ID_PATTERN.test(definition.id)) {
    throw new McpConnectorInvalidError(
      `connector id "${definition.id}" must match ${String(ID_PATTERN)}`,
    )
  }
  const shared = {
    serverName: definition.id,
    toolCallTimeoutMs: definition.toolCallTimeoutMs ?? 60_000,
    failOnStartupError: definition.failOnStartupError ?? false,
  }
  if (definition.transport === 'stdio') {
    if (definition.command === undefined || definition.command === '') {
      throw new McpConnectorInvalidError(`connector "${definition.id}" is stdio but names no command`)
    }
    // Judged here so an unusable mapping is refused at `put` time, beside
    // every other field the transport needs, rather than at the mount that
    // would have spawned the server without its credential.
    for (const [name, ref] of Object.entries(definition.envFrom ?? {})) {
      if (!ENV_NAME_PATTERN.test(name)) {
        throw new McpConnectorInvalidError(
          `connector "${definition.id}" maps envFrom entry "${name}", which is not an environment variable name`,
        )
      }
      if (!isCredentialRefName(ref)) {
        throw new McpConnectorInvalidError(
          `connector "${definition.id}" points envFrom "${name}" at "${ref}", which is not a credential reference`,
        )
      }
    }
    return {
      transport: 'stdio',
      ...shared,
      command: definition.command,
      args: definition.args ?? [],
      // The secret half is deliberately absent: `envFrom` is resolved at mount
      // time (see `resolveEnvFrom`), so no value a credential store holds ever
      // reaches this config — which is also the mount signature, and the
      // argument the loader logs on a refusal.
      env: definition.env ?? {},
      cwd: definition.cwd ?? '',
    }
  }
  if (definition.url === undefined || definition.url === '') {
    throw new McpConnectorInvalidError(`connector "${definition.id}" is ${definition.transport} but names no url`)
  }
  if (definition.transport === 'streamable-http') {
    return { transport: 'streamable-http', ...shared, url: definition.url, headers: definition.headers ?? {} }
  }
  return {
    transport: 'streamable-http-oauth',
    ...shared,
    url: definition.url,
    headers: definition.headers ?? {},
    label: definition.label === '' ? definition.id : definition.label,
    oauth: {
      // clientId/clientSecret are deliberately absent: a registry-mounted
      // connector keeps its client pair in the credential record next to its
      // tokens, which `McpOAuthProvider` reads through its own store when the
      // config carries none. See `McpOAuthGrant.clientConfigured`.
      redirectUri: definition.redirectUri ?? 'http://127.0.0.1:33418/mcp-oauth/callback',
      ...definition.scope === undefined || definition.scope === '' ? {} : { scope: definition.scope },
      clientName: `dsh (${definition.id})`,
    },
  }
}

/**
 * Resolve a stdio connector's `envFrom` mapping into the env dictionary its
 * child is actually spawned with.
 *
 * Takes the reader as an argument rather than reaching for `ctx.credentials`
 * itself, so the resolution rule is testable without a credential provider,
 * and so the one place a secret is handled stays a single short function.
 *
 * Every missing reference is reported together. Resolving one at a time would
 * make a connector needing two credentials take two failed mounts to
 * configure, each naming only the next thing wrong.
 *
 * @param id - the connector being mounted, for the error message.
 * @param envFrom - child variable name to credential reference.
 * @param read - resolves one reference to its value, or undefined when unset.
 * @returns child variable name to secret value.
 * @throws {McpConnectorInvalidError} when any reference resolves to nothing.
 */
export async function resolveEnvFrom(
  id: string,
  envFrom: Record<string, string>,
  read: (ref: CredentialRef) => Promise<string | undefined>,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  const missing: string[] = []
  for (const [name, ref] of Object.entries(envFrom)) {
    // `isCredentialRefName` first: `credentialRef` throws on a name outside
    // the grammar, and a stored definition that predates this field's
    // validation must read as "not set" rather than as a crash.
    const value = isCredentialRefName(ref) ? await read(credentialRef(ref)) : undefined
    if (value === undefined || value === '') missing.push(`${name} (${ref})`)
    else resolved[name] = value
  }
  if (missing.length > 0) {
    throw new McpConnectorInvalidError(
      `connector "${id}" needs credentials that are not set: ${missing.join(', ')}. `
      + 'Set each one in the environment or in $DSH_HOME/.credentials.yaml.',
    )
  }
  return resolved
}

/** `ctx.mcpConnectors`: the durable connector list, its mounts, and the operations over both. */
export class McpConnectorRegistry extends Service {
  /** The settings section and the credential store are both load-bearing, not optional. */
  static inject = ['settings', 'credentials']

  private readonly mounts = new Map<string, Mount>()
  /** Serializes reconciles so two settings commits cannot interleave their mount swaps. */
  private reconciling: Promise<void> = Promise.resolve()
  private scope: SettingsScope<McpConnectorSection> | undefined

  /** @param ctx - host context carrying `ctx.settings` and `ctx.credentials`. */
  constructor(ctx: Context) {
    super(ctx, 'mcpConnectors')
  }

  /**
   * Adopt the settings scope this registry reconciles from, and mount what it
   * already holds.
   * @param scope - the registered `mcp-connector` settings scope.
   */
  async start(scope: SettingsScope<McpConnectorSection>): Promise<void> {
    this.scope = scope
    this.ctx.effect(() => {
      const unwatch = scope.watch(() => { void this.reconcile() })
      return () => {
        unwatch()
        // Disposal order matters: stop reacting to settings first, then take
        // every mount down, so a commit landing mid-teardown cannot mount one
        // back behind the disposal.
        void this.reconcile([])
      }
    }, 'mcp-connector.settingsWatch')
    await this.reconcile()
  }

  /** Every configured connector's stored definition, in document order. */
  definitions(): readonly McpConnectorDefinition[] {
    return this.scope?.get().connectors ?? []
  }

  /**
   * Every connector as a listing surface sees it: definition, mount health,
   * contributed tools, and — for an OAuth connector — its stored
   * authorization and the credential key its sign-in flow is registered
   * under. Never a token or a client secret.
   * @returns one entry per configured connector, in document order.
   */
  async list(): Promise<readonly McpConnectorEntry[]> {
    return await Promise.all(this.definitions().map(definition => this.describe(definition)))
  }

  /**
   * One connector as a listing surface sees it.
   * @param id - the connector to describe.
   * @returns its entry.
   * @throws {McpConnectorNotFoundError} when nothing is configured under that id.
   */
  async get(id: string): Promise<McpConnectorEntry> {
    return await this.describe(this.require(id))
  }

  /**
   * Add a connector, or replace one already configured under the same id.
   * @param definition - the connector to store; unspecified optional fields default.
   * @throws {McpConnectorInvalidError} when the definition cannot be mounted as written.
   */
  async put(definition: McpConnectorDefinition): Promise<void> {
    // Judged before the write, not after: a definition that cannot mount has
    // no business reaching the settings document, where it would come back on
    // every boot and fail again.
    buildClientConfig(definition)
    const connectors = [...this.definitions()]
    const at = connectors.findIndex(candidate => candidate.id === definition.id)
    if (at < 0) connectors.push(definition)
    else connectors[at] = definition
    assertConnectorIdUnfolded(connectors.map(candidate => candidate.id))
    await this.write(connectors)
  }

  /**
   * Change some fields of a configured connector, leaving the rest.
   * @param id - the connector to change.
   * @param patch - fields to overwrite; `id` is ignored.
   * @throws {McpConnectorNotFoundError} when nothing is configured under that id.
   * @throws {McpConnectorInvalidError} when the result cannot be mounted.
   */
  async patch(id: string, patch: Partial<McpConnectorDefinition>): Promise<void> {
    const { id: _ignored, ...fields } = patch
    await this.put({ ...this.require(id), ...fields })
  }

  /**
   * Remove a connector.
   * @param id - the connector to remove.
   * @param forgetAuthorization - also delete its stored OAuth grant; defaults
   *   to true, because a connector nobody can see any more should not leave a
   *   live refresh token behind in the credential store.
   * @throws {McpConnectorNotFoundError} when nothing is configured under that id.
   */
  async remove(id: string, forgetAuthorization = true): Promise<void> {
    this.require(id)
    await this.write(this.definitions().filter(candidate => candidate.id !== id))
    if (forgetAuthorization) await new McpOAuthStore(this.ctx, id).clear()
  }

  /**
   * Forget one connector's stored authorization, leaving its definition — the
   * Sign out path.
   * @param id - the connector to sign out.
   * @throws {McpConnectorNotFoundError} when nothing is configured under that id.
   */
  async signOut(id: string): Promise<void> {
    this.require(id)
    await new McpOAuthStore(this.ctx, id).clear()
  }

  /**
   * Copy one connector's stored authorization onto another.
   *
   * An authorization server issues a grant for the *scopes* consented to, not
   * for one endpoint, so a provider that splits its MCP surface across several
   * servers — Google's Gmail, Drive and Calendar each have their own — can be
   * reached with a single consent: sign one connector in with every scope the
   * set needs, then copy that grant to its siblings. Without this the human
   * consents once per connector to the same account, through the same client,
   * for scopes they already approved.
   *
   * Only the portable half travels (see `portableGrant`); the source's cached
   * discovery does not, because the target is a different resource and must
   * discover its own.
   *
   * Refuses rather than guesses: a source with no tokens, a target that would
   * lose a grant it already holds, and a target whose configured scopes the
   * copied grant does not cover are all errors, the last two overridable with
   * `force` for the human who knows better than the check does.
   *
   * @param sourceId - the signed-in connector to copy from.
   * @param targetId - the connector to copy onto.
   * @param force - overwrite a target that already holds a grant, and accept a
   *   scope set the copied grant does not cover.
   * @returns what was copied, for the surface reporting it.
   * @throws {McpConnectorNotFoundError} when either id is not configured.
   * @throws {McpConnectorInvalidError} on any of the refusals above.
   */
  async cloneAuthorization(sourceId: string, targetId: string, force = false): Promise<McpClonedAuthorization> {
    const source = this.require(sourceId)
    const target = this.require(targetId)
    if (sourceId === targetId) {
      throw new McpConnectorInvalidError(`"${sourceId}" cannot copy its authorization onto itself`)
    }
    for (const definition of [source, target]) {
      if (definition.transport !== 'streamable-http-oauth') {
        throw new McpConnectorInvalidError(
          `connector "${definition.id}" is ${definition.transport} and holds no OAuth authorization`,
        )
      }
    }
    const sourceGrant = await new McpOAuthStore(this.ctx, sourceId).read()
    if (sourceGrant.tokens === undefined) {
      throw new McpConnectorInvalidError(
        `connector "${sourceId}" is not signed in — sign it in first, then copy its authorization`,
      )
    }
    const scope = grantedScopes(sourceGrant)
    const wanted = (target.scope ?? '').split(/\s+/u).filter(entry => entry !== '')
    // An undefined `scope` means the server named none in its token response,
    // which is a silence this cannot read as either coverage or a gap.
    const missing = scope === undefined ? [] : wanted.filter(entry => !scope.includes(entry))
    if (missing.length > 0 && !force) {
      throw new McpConnectorInvalidError(
        `the authorization stored for "${sourceId}" does not cover ${missing.join(', ')}, which "${targetId}" asks for `
        + `— sign "${sourceId}" in again with those scopes, or pass force to copy it anyway`,
      )
    }
    const targetStore = new McpOAuthStore(this.ctx, targetId)
    const replaced = (await targetStore.read()).tokens !== undefined
    if (replaced && !force) {
      throw new McpConnectorInvalidError(
        `connector "${targetId}" already holds an authorization — pass force to replace it`,
      )
    }
    await targetStore.merge(portableGrant(sourceGrant))
    return {
      source: sourceId,
      target: targetId,
      ...scope === undefined ? {} : { scope },
      replaced,
    }
  }

  /**
   * Store the OAuth client pair a human registered by hand for one connector.
   * @param id - the connector the pair belongs to.
   * @param clientId - the registered client id.
   * @param clientSecret - the registered client secret, where the authorization server requires one.
   * @throws {McpConnectorNotFoundError} when nothing is configured under that id.
   */
  async setClientCredentials(id: string, clientId: string, clientSecret?: string): Promise<void> {
    this.require(id)
    await new McpOAuthStore(this.ctx, id).setConfiguredClient(clientId, clientSecret)
  }

  /**
   * The credential key one OAuth connector's `ctx.authorization` flow is
   * registered under — what a sign-in surface passes to `begin()`.
   * @param id - the connector to address.
   * @returns the credential key.
   */
  authorizationKey(id: string): string {
    return connectorCredentialKey(id)
  }

  /** The stored definition for an id, or a typed refusal. */
  private require(id: string): McpConnectorDefinition {
    const found = this.definitions().find(candidate => candidate.id === id)
    if (found === undefined) throw new McpConnectorNotFoundError(id)
    return found
  }

  /** Commit the next connector list and reconcile the mounts against it. */
  private async write(connectors: readonly McpConnectorDefinition[]): Promise<void> {
    const scope = this.scope
    if (scope === undefined) throw new Error('mcp-connector: the registry has not started yet')
    await scope.replace({ connectors: [...connectors] })
    // The settings watcher reconciles too, but awaiting it here is what lets
    // a caller — the CLI most concretely — return only once the connector it
    // just added is actually mounted.
    await this.reconcile()
  }

  /** Project one definition into the shape a listing surface reads. */
  /**
   * The config one definition mounts with, secrets included.
   *
   * Split from {@link buildClientConfig} because that one is pure, synchronous,
   * and doubles as both the `put` validation and the mount signature; this one
   * is the only place a credential value is read, and it is read once per
   * mount rather than held anywhere.
   *
   * @param definition - the connector being mounted.
   * @returns its plugin config, with `envFrom` folded into `env`.
   * @throws {McpConnectorInvalidError} when a referenced credential is unset.
   */
  private async mountConfig(definition: McpConnectorDefinition): Promise<McpClientConfig> {
    const config = buildClientConfig(definition)
    const envFrom = definition.envFrom ?? {}
    if (config.transport !== 'stdio' || Object.keys(envFrom).length === 0) return config
    const secrets = await resolveEnvFrom(
      definition.id,
      envFrom,
      async ref => (await this.ctx.credentials.resolve(ref))?.value,
    )
    // Secrets last: a definition that names both an `env` entry and an
    // `envFrom` entry for one variable means the credential, not the literal.
    return { ...config, env: { ...config.env, ...secrets } }
  }

  private async describe(definition: McpConnectorDefinition): Promise<McpConnectorEntry> {
    const mount = this.mounts.get(definition.id)
    const prefix = `mcp__${definition.id}__`
    // `ctx.get`, not `ctx.tools`: Cordis refuses a property read from a fiber
    // that did not declare the dependency, and this service deliberately does
    // not — the connector list is readable in a composition with no tool
    // registry at all (the CLI's own profile is exactly that), it just has
    // nothing to report under `tools` there.
    const tools = this.ctx.get('tools')?.schemas().map(schema => schema.name).filter(name => name.startsWith(prefix))
      ?? []
    let health: McpConnectorHealth = 'disabled'
    if (mount !== undefined) health = mount.error === undefined && tools.length > 0 ? 'connected' : 'failed'
    const entry: McpConnectorEntry = {
      definition,
      health,
      tools,
      ...mount?.error === undefined ? {} : { error: mount.error },
    }
    if (definition.transport !== 'streamable-http-oauth') return entry
    return {
      ...entry,
      oauth: await new McpOAuthStore(this.ctx, definition.id).status(),
      authorizationKey: connectorCredentialKey(definition.id),
    }
  }

  /**
   * Bring the live mounts in line with the stored definitions.
   *
   * Serialized on one chain: two settings commits landing together would
   * otherwise each compute a swap from the same starting state and one would
   * dispose a fiber the other had just created.
   *
   * @param override - mount exactly this list instead of the stored one; `[]` takes everything down.
   */
  private reconcile(override?: readonly McpConnectorDefinition[]): Promise<void> {
    const run = this.reconciling.then(async () => { await this.reconcileOnce(override) })
    // The chain tail must survive a failed reconcile, or one bad definition
    // would wedge every later edit.
    this.reconciling = run.catch(() => {})
    return run
  }

  /** One reconcile pass; see {@link reconcile}. */
  private async reconcileOnce(override?: readonly McpConnectorDefinition[]): Promise<void> {
    const wanted = new Map<string, { definition: McpConnectorDefinition; signature: string }>()
    for (const definition of override ?? this.definitions()) {
      if (!definition.enabled) continue
      let signature: string
      try {
        // The mapping rides in the signature, the resolved values do not: an
        // edit that repoints a variable at another credential must remount,
        // and a signature is compared, kept, and read by a human debugging a
        // reconcile, so no secret belongs in one. A rotation in place is
        // therefore not noticed here; it takes effect on the next mount.
        signature = JSON.stringify([buildClientConfig(definition), definition.envFrom ?? {}])
      } catch (error) {
        // An invalid definition is reported as a failed mount rather than
        // thrown: the other connectors must still reconcile, and a surface
        // needs the reason next to the connector it belongs to.
        this.mounts.set(definition.id, {
          signature: '',
          fiber: undefined as unknown as Fiber,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
      wanted.set(definition.id, { definition, signature })
    }

    for (const [id, mount] of [...this.mounts]) {
      const next = wanted.get(id)
      if (next !== undefined && next.signature === mount.signature && mount.error === undefined) continue
      this.mounts.delete(id)
      if (mount.fiber !== undefined) {
        try {
          await mount.fiber.dispose()
        } catch (error) {
          this.ctx.logger.error(`mcp-connector(${id}): failed to unmount cleanly`)
          this.ctx.logger.error(error)
        }
      }
    }

    for (const [id, { definition, signature }] of wanted) {
      if (this.mounts.has(id)) continue
      try {
        const fiber = this.ctx.plugin(mcpClientOAuth, await this.mountConfig(definition))
        this.mounts.set(id, { signature, fiber })
        // Awaiting the fiber surfaces a load-time refusal (a duplicate
        // serverName, a rejected reconnect policy) as this connector's own
        // error rather than as an unhandled rejection somewhere else.
        await fiber
      } catch (error) {
        this.ctx.logger.error(`mcp-connector(${id}): failed to mount`)
        this.ctx.logger.error(error)
        const existing = this.mounts.get(id)
        this.mounts.set(id, {
          signature,
          fiber: existing?.fiber as Fiber,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}

export default McpConnectorRegistry
