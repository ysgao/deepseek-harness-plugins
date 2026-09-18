/**
 * MCP connectors settings section: one row per configured connector, its
 * mount state and contributed tools, the sign-in affordance for an OAuth
 * connector, and one editor card at a time.
 *
 * The sign-in half renders `ctx.authorization`'s neutral notice/prompt
 * vocabulary and knows nothing about OAuth itself — the same posture the seam
 * documents ("a surface that renders one flow renders all of them"). So the
 * consent URL, the paste fallback, and any future device-code or
 * pick-an-account step all arrive here as notices and prompts without this
 * file changing.
 *
 * @module dsh-plugins-client-ui-settings-mcp-connector/McpConnectorsSection
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpConnectorDefinition, McpConnectorEntry } from 'dsh-plugins-api-mcp-connector-controller/types'
import type { IMcpConnectors, McpSignInState } from './runtime.ts'
import { IDLE_SIGN_IN } from './runtime.ts'
import { ConnectorEditor } from './ConnectorEditor.tsx'
import type { en } from './locales.ts'
import styles from './McpConnectorsSection.module.css'

/** Injected dependencies of {@link McpConnectorsSection} (slot `inject`). */
export interface McpConnectorsSectionInjected {
  /** The connector-registry face this page drives. */
  connectors: IMcpConnectors
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: IMcpConnectors['state']
  }
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call), with every member
 * optional because the renderer only has them once this plugin's own `inject`
 * thunk has run. The `hooks: { snapshot }` entry arrives as a bound
 * `useSnapshot` selector hook rather than as a value — which is what lets the
 * section re-render on store changes without subscribing by hand.
 */
export type McpConnectorsSectionProps = Partial<InjectFace<McpConnectorsSectionInjected>>

/** The resolved inject face, once every member is known present. */
type McpConnectorsSectionFace = InjectFace<McpConnectorsSectionInjected>

/** Interpolate `{name}` placeholders in a copy string. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
}

/** What a connector's row points at, in one line. */
function target(definition: McpConnectorDefinition): string {
  if (definition.transport === 'stdio') {
    return `${definition.command ?? ''} ${(definition.args ?? []).join(' ')}`.trim()
  }
  return definition.url ?? ''
}

/** The live sign-in conversation for one connector, when one is running. */
function SignInFlow(props: {
  id: string
  state: McpSignInState
  connectors: Pick<IMcpConnectors, 'cancelSignIn' | 'respond' | 'decline'>
  t: (key: keyof typeof en) => string
}): ReactNode {
  const { id, state, connectors, t } = props
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const prompt = state.pendingPrompt

  // Takes the answer explicitly rather than reading state from closure: a
  // select option's click handler cannot set the draft and read it back in
  // the same tick.
  const submit = async (value: string): Promise<void> => {
    setBusy(true)
    try {
      await connectors.respond(id, value)
      setAnswer('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['flow']}>
      {state.notices.length === 0
        ? <p className={styles['notice']}>{t('signInWaiting')}</p>
        : state.notices.map((notice, index) => (
          // Notices accumulate for the life of one attempt; the index is
          // stable because nothing reorders or removes an earlier one.
          <p key={index} className={styles['notice']}>
            {notice.message}
            {notice.url === undefined
              ? null
              : (
                <>
                  {' '}
                  <a className={styles['noticeLink']} href={notice.url} target="_blank" rel="noreferrer">
                    {notice.url}
                  </a>
                </>
              )}
            {notice.code === undefined ? null : ` (${notice.code})`}
          </p>
        ))}
      {prompt === undefined
        ? null
        : (
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{prompt.message}</span>
            {prompt.kind === 'select'
              ? (
                <div className={styles['fieldRow']}>
                  {prompt.options.map(option => (
                    <Button
                      key={option.id}
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => { void submit(option.id) }}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              )
              : (
                <div className={styles['fieldRow']}>
                  <input
                    className={styles['select']}
                    type={prompt.kind === 'secret' ? 'password' : 'text'}
                    autoComplete="off"
                    value={answer}
                    placeholder={prompt.placeholder}
                    aria-label={prompt.message}
                    disabled={busy}
                    onChange={(event) => { setAnswer(event.target.value) }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || answer.length === 0}
                    onClick={() => { void submit(answer) }}
                  >
                    {t('signInSubmit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => { void connectors.decline(id) }}
                  >
                    {t('signInDecline')}
                  </Button>
                </div>
              )}
          </div>
        )}
      <div className={styles['fieldRow']}>
        <Button variant="ghost" size="sm" onClick={() => { void connectors.cancelSignIn(id) }}>
          {t('signInCancel')}
        </Button>
      </div>
    </div>
  )
}

/** One connector's row. */
function ConnectorRow(props: {
  entry: McpConnectorEntry
  signIn: McpSignInState
  connectors: IMcpConnectors
  t: (key: keyof typeof en) => string
  editing: boolean
  onEdit: () => void
  onCloseEditor: () => void
}): ReactNode {
  const { entry, signIn, connectors, t } = props
  const { definition } = entry
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const name = definition.label === '' ? definition.id : definition.label
  const oauth = entry.oauth

  const guard = async (run: () => Promise<void>): Promise<void> => {
    setFailure(undefined)
    try {
      await run()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  const authorization = oauth === undefined
    ? undefined
    : oauth.authorized
      ? oauth.renewable ? t('signedInRenewing') : t('signedInNoRefresh')
      : t('notSignedIn')

  return (
    <li className={styles['rowCard']}>
      <div className={styles['rowHead']}>
        <div className={styles['rowIdentity']}>
          <span className={styles['rowName']}>
            <StateDot state={entry.health === 'connected' ? 'done' : entry.health === 'failed' ? 'error' : 'idle'} />
            {name}
          </span>
          <span className={styles['rowTarget']}>{target(definition)}</span>
        </div>
      </div>
      <div className={styles['rowMeta']}>
        <span>
          {entry.health === 'connected'
            ? t('stateConnected')
            : entry.health === 'failed' ? t('stateFailed') : t('stateDisabled')}
        </span>
        <span>
          {entry.tools.length === 0
            ? t('toolCountNone')
            : fill(t('toolCount'), { count: String(entry.tools.length) })}
        </span>
        {authorization === undefined ? null : <span>{authorization}</span>}
      </div>
      {entry.error === undefined ? null : <p className={styles['error']}>{entry.error}</p>}
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
      {oauth !== undefined && !oauth.clientConfigured
        ? <p className={styles['hint']}>{t('needsClient')}</p>
        : null}

      {signIn.inFlight
        ? <SignInFlow id={definition.id} state={signIn} connectors={connectors} t={t} />
        : (
          <div className={styles['rowActions']}>
            {oauth === undefined
              ? null
              : (
                // Never gated on a stored client. A server publishing an RFC
                // 7591 registration endpoint acquires its client during this
                // very attempt, so disabling this until one existed made every
                // self-registering server impossible to sign in to. A server
                // that genuinely needs one by hand says so when the attempt
                // fails, and that message lands in `failure` above.
                <Button
                  variant={oauth.authorized ? 'outline' : 'primary'}
                  size="sm"
                  onClick={() => { void guard(async () => { await connectors.signIn(definition.id) }) }}
                >
                  {oauth.authorized ? t('signInAgain') : t('signIn')}
                </Button>
              )}
            {oauth?.authorized === true
              ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { void guard(async () => { await connectors.signOut(definition.id) }) }}
                >
                  {t('signOut')}
                </Button>
              )
              : null}
            <Button variant="ghost" size="sm" onClick={props.onEdit}>{t('edit')}</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { void guard(async () => { await connectors.remove(definition.id) }) }}
            >
              {t('remove')}
            </Button>
          </div>
        )}

      {entry.tools.length === 0 ? null : <p className={styles['toolList']}>{entry.tools.join(', ')}</p>}

      {props.editing
        ? (
          <ConnectorEditor
            definition={definition}
            clientConfigured={oauth?.clientConfigured ?? false}
            t={t}
            onCancel={props.onCloseEditor}
            onSave={async (next, client) => {
              await connectors.put(next)
              if (client !== undefined) {
                await connectors.setClientCredentials(definition.id, client.clientId, client.clientSecret)
              }
              props.onCloseEditor()
            }}
          />
        )
        : null}
    </li>
  )
}

/**
 * Render the MCP connectors settings page.
 *
 * Splits in two the way every slot-registered section in this app does: the
 * outer component receives a partially-bound face and renders nothing until
 * the renderer has supplied it, and the inner one — which may then call hooks
 * unconditionally — owns the actual page.
 * @param props - see {@link McpConnectorsSectionProps}.
 * @returns the section element, or null before the face is bound.
 */
export function McpConnectorsSection(props: McpConnectorsSectionProps): ReactNode {
  const { connectors, useSnapshot, t } = props
  if (connectors === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ connectors, useSnapshot, t }} />
}

/** The page proper, with its whole inject face resolved. */
function Loaded({ injected }: { injected: McpConnectorsSectionFace }): ReactNode {
  const { connectors, t } = injected
  const snapshot = injected.useSnapshot(state => state)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    // Loads on first mount only; every later change arrives as a pushed
    // `connectors-changed` frame on the runtime's own follow stream.
    if (snapshot.status === 'idle') void connectors.refresh()
  }, [connectors, snapshot.status])

  return (
    <section className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>

      {snapshot.status === 'error'
        ? (
          <div className={styles['fieldRow']}>
            <p className={styles['error']}>{snapshot.error ?? t('loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => { void connectors.refresh() }}>{t('retry')}</Button>
          </div>
        )
        : null}

      {snapshot.entries.length === 0 && snapshot.status === 'loaded'
        ? <p className={styles['empty']}>{t('empty')}</p>
        : (
          <ul className={styles['rows']}>
            {snapshot.entries.map(entry => (
              <ConnectorRow
                key={entry.definition.id}
                entry={entry}
                signIn={snapshot.byId[entry.definition.id] ?? IDLE_SIGN_IN}
                connectors={connectors}
                t={t}
                editing={editing === entry.definition.id}
                onEdit={() => { setEditing(entry.definition.id) }}
                onCloseEditor={() => { setEditing(undefined) }}
              />
            ))}
          </ul>
        )}

      {adding
        ? (
          <ConnectorEditor
            t={t}
            onCancel={() => { setAdding(false) }}
            onSave={async (next, client) => {
              await connectors.put(next)
              if (client !== undefined) {
                await connectors.setClientCredentials(next.id, client.clientId, client.clientSecret)
              }
              setAdding(false)
            }}
          />
        )
        : (
          <div className={styles['rowActions']}>
            <Button variant="outline" size="sm" onClick={() => { setAdding(true) }}>{t('add')}</Button>
          </div>
        )}
    </section>
  )
}
