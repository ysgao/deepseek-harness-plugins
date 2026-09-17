/**
 * Durable half of the OAuth bridge: reads and writes one connector's
 * {@link McpOAuthGrant} through `ctx.credentials`'s record key space.
 *
 * Every write goes through `modifyRecord`, never a read-then-`set` pair. The
 * credential seam documents `modifyRecord` as the only write path precisely
 * because a correct write depends on the current value and its exclusion
 * holds across processes where the backing store supports it — which is what
 * makes a refresh-token rotation safe when a second `dsh` process (a CLI run
 * beside the GUI) is rotating the same grant at the same moment.
 *
 * @module dsh-plugins-mcp-client-oauth/oauth/store
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { McpOAuthGrant, McpOAuthStatus } from './types.ts'

/** Credential-key scope every record this package owns is filed under. */
export const MCP_OAUTH_SCOPE = 'mcp-connector'

/**
 * Derive the credential key holding one connector's grant.
 *
 * `serverName`'s own grammar (`[A-Za-z0-9_-]{1,32}`) is wider than a
 * credential-key segment's (`[a-z][a-z0-9-]*`), so the id is folded down
 * rather than passed through: upper case lowers, `_` becomes `-`. The fold is
 * injective enough for the names it accepts but not in general (`a_b` and
 * `a-b` collide), so a collision is refused at configuration time by
 * {@link assertConnectorIdUnfolded} instead of being papered over here —
 * silently sharing one grant between two connectors would let either
 * overwrite the other's tokens.
 *
 * @param serverName - the connector's `serverName`.
 * @returns the credential key its grant record is stored under.
 * @throws TypeError when the folded id is still not a legal key segment.
 */
export function connectorCredentialKey(serverName: string): CredentialKey {
  const folded = foldConnectorId(serverName)
  if (!isCredentialKeySegment(folded)) {
    throw new TypeError(
      `mcp-client-oauth: serverName "${serverName}" cannot address a credential record — `
      + 'it must start with a letter and contain only letters, digits, "-" and "_"',
    )
  }
  return credentialKey(MCP_OAUTH_SCOPE, folded)
}

/**
 * The credential-key segment one `serverName` folds down to.
 * @param serverName - the connector's `serverName`.
 * @returns the lowercased, hyphenated segment.
 */
export function foldConnectorId(serverName: string): string {
  return serverName.toLowerCase().replaceAll('_', '-')
}

/**
 * Refuse two connector names that fold to one credential key. Called by the
 * registry before it mounts a set of connectors, where the whole set is
 * visible; one plugin instance in isolation cannot see the collision.
 * @param serverNames - every connector name about to be mounted together.
 * @throws Error naming both colliding connectors.
 */
export function assertConnectorIdUnfolded(serverNames: readonly string[]): void {
  const seen = new Map<string, string>()
  for (const name of serverNames) {
    const folded = foldConnectorId(name)
    const previous = seen.get(folded)
    if (previous !== undefined && previous !== name) {
      throw new Error(
        `mcp-client-oauth: connectors "${previous}" and "${name}" both address the credential record `
        + `"${MCP_OAUTH_SCOPE}/${folded}" — rename one so each connector owns its own stored authorization`,
      )
    }
    seen.set(folded, name)
  }
}

/**
 * A patch over the stored grant.
 *
 * Spelled out rather than written as `Partial<McpOAuthGrant>` because under
 * `exactOptionalPropertyTypes` those two are different types: `Partial` makes
 * a field omittable but still refuses an explicit `undefined`, and passing an
 * explicit `undefined` is exactly how a caller says "remove this field" —
 * `invalidateCredentials('tokens')` has no other way to express it.
 */
export type McpOAuthGrantPatch = { [K in keyof McpOAuthGrant]?: McpOAuthGrant[K] | undefined }

/** An empty grant, the value a reader sees before anything was ever stored. */
const EMPTY: McpOAuthGrant = { version: 1 }

/**
 * Narrow one stored record to this package's payload. A record written by
 * something else — an `api-key` record filed under a colliding key, or a
 * payload from a future version — reads as empty rather than throwing: the
 * seam hands a `GrantRecord.payload` back verbatim and explicitly does not
 * interpret it, so only its owner can judge it, and judging it unreadable is
 * the same situation as never having authorized.
 */
function readGrant(record: CredentialRecord | undefined): McpOAuthGrant {
  if (record?.kind !== 'grant') return EMPTY
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return EMPTY
  const grant = payload as Partial<McpOAuthGrant>
  if (grant.version !== 1) return EMPTY
  return grant as McpOAuthGrant
}

/** One connector's durable OAuth state, addressed by its credential key. */
export class McpOAuthStore {
  /** The credential record this store reads and writes. */
  readonly key: CredentialKey

  /**
   * @param ctx - context carrying `ctx.credentials`.
   * @param serverName - the connector whose grant this store owns.
   */
  constructor(private readonly ctx: Context, serverName: string) {
    this.key = connectorCredentialKey(serverName)
  }

  /**
   * Read the stored grant.
   * @returns the grant, or an empty one when nothing readable is stored.
   */
  async read(): Promise<McpOAuthGrant> {
    return readGrant(await this.ctx.credentials.readRecord(this.key))
  }

  /**
   * Merge a patch into the stored grant under the seam's write exclusion.
   *
   * The patch is computed from the record as it stands at the moment the
   * write is exclusive, not from a value read earlier — which is the whole
   * point of routing a token rotation through here.
   *
   * @param patch - fields to merge; a key set to `undefined` is removed.
   * @returns the grant as it stands after the write.
   */
  async merge(patch: McpOAuthGrantPatch): Promise<McpOAuthGrant> {
    let next: McpOAuthGrant = EMPTY
    await this.ctx.credentials.modifyRecord(this.key, (current) => {
      const merged: Record<string, unknown> = { ...readGrant(current), ...patch, version: 1 }
      // An explicitly-undefined patch field removes the key outright rather
      // than storing `undefined`: the record round-trips through JSON, where
      // an `undefined` value and an absent key are the same thing on the way
      // back but not on the way in.
      for (const [field, value] of Object.entries(merged)) {
        if (value === undefined) delete merged[field]
      }
      next = merged as unknown as McpOAuthGrant
      return Promise.resolve({ kind: 'grant', payload: next })
    })
    return next
  }

  /**
   * Remove the stored grant entirely — the "sign out" path, and the one
   * `invalidateCredentials('all')` takes when a server rejects everything.
   */
  async clear(): Promise<void> {
    await this.ctx.credentials.deleteRecord(this.key)
  }

  /**
   * Store the OAuth client pair a human registered by hand.
   *
   * Written here, next to the tokens, rather than into the connector's
   * settings section: a client secret is a credential, and the credential
   * seam's record space is where a credential belongs — a settings document
   * is a plain file a configuration UI reads back in full.
   *
   * @param clientId - the registered client id.
   * @param clientSecret - the registered client secret, when the authorization
   *   server requires one (Google's does, for every client type).
   */
  async setConfiguredClient(clientId: string, clientSecret?: string): Promise<void> {
    await this.merge({
      clientInformation: { client_id: clientId, ...clientSecret === undefined ? {} : { client_secret: clientSecret } },
      clientConfigured: true,
    })
  }

  /** Forget a hand-registered client pair, leaving any stored tokens alone. */
  async clearConfiguredClient(): Promise<void> {
    await this.merge({ clientInformation: undefined, clientConfigured: undefined })
  }

  /**
   * Describe the stored authorization for a listing surface, without ever
   * reading a token value out to the caller.
   * @returns presence, renewability, and the timestamps a surface shows.
   */
  async status(): Promise<McpOAuthStatus> {
    const grant = await this.read()
    const clientId = grant.clientInformation?.client_id
    const client = {
      clientConfigured: clientId !== undefined,
      ...clientId === undefined ? {} : { clientId },
    }
    const tokens = grant.tokens
    if (tokens === undefined) return { authorized: false, renewable: false, ...client }
    return {
      ...client,
      authorized: true,
      renewable: typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0,
      ...grant.obtainedAt === undefined ? {} : { obtainedAt: grant.obtainedAt },
      ...grant.obtainedAt === undefined || typeof tokens.expires_in !== 'number'
        ? {}
        : { expiresAt: grant.obtainedAt + tokens.expires_in * 1000 },
      ...typeof tokens.scope === 'string' ? { scope: tokens.scope } : {},
    }
  }
}
