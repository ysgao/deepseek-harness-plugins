/**
 * The add/edit card for one connector.
 *
 * Which fields it shows follows the selected transport, but the draft keeps
 * every field regardless — a human who switches a connector from stdio to
 * OAuth and back gets their command line and their URL both still there. That
 * mirrors how the stored definition is shaped (one flat record, `transport`
 * deciding what is read), so the form and the record agree about what
 * "switching transport" means.
 *
 * @module dsh-plugins-client-ui-settings-mcp-connector/ConnectorEditor
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  McpConnectorDefinition, McpConnectorTransport,
} from 'dsh-plugins-api-mcp-connector-controller/types'
import type { en } from './locales.ts'
import styles from './McpConnectorsSection.module.css'

/** Props of {@link ConnectorEditor}. */
export interface ConnectorEditorProps {
  /** The connector being edited, or `undefined` when adding a new one. */
  definition?: McpConnectorDefinition | undefined
  /** Whether an OAuth client id is already stored for this connector. */
  clientConfigured?: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /**
   * Commit the draft. `client` is present only when the human typed one; an
   * untouched client field must not overwrite a stored secret with a blank.
   */
  onSave: (definition: McpConnectorDefinition, client?: { clientId: string; clientSecret?: string }) => Promise<void>
  /** Abandon the draft. */
  onCancel: () => void
}

/** The editable draft: every field as text, converted on save. */
interface Draft {
  id: string
  label: string
  enabled: boolean
  transport: McpConnectorTransport
  url: string
  command: string
  args: string
  env: string
  envFrom: string
  cwd: string
  headers: string
  scope: string
  redirectUri: string
  clientId: string
  clientSecret: string
}

/** Render a `KEY=VALUE` dictionary as one entry per line. */
function linesFromDict(dict: Record<string, string> | undefined, separator: string): string {
  return Object.entries(dict ?? {}).map(([key, value]) => `${key}${separator}${value}`).join('\n')
}

/**
 * Parse one entry per line back into a dictionary. A line with no separator
 * is dropped rather than stored under an empty key — a half-typed line is not
 * a header.
 */
function dictFromLines(text: string, separator: string): Record<string, string> {
  const dict: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const at = trimmed.indexOf(separator)
    if (at <= 0) continue
    dict[trimmed.slice(0, at).trim()] = trimmed.slice(at + separator.length).trim()
  }
  return dict
}

/** Seed a draft from an existing definition, or from the empty defaults. */
function toDraft(definition: McpConnectorDefinition | undefined): Draft {
  return {
    id: definition?.id ?? '',
    label: definition?.label ?? '',
    enabled: definition?.enabled ?? true,
    transport: definition?.transport ?? 'streamable-http-oauth',
    url: definition?.url ?? '',
    command: definition?.command ?? '',
    args: (definition?.args ?? []).join('\n'),
    env: linesFromDict(definition?.env, '='),
    envFrom: linesFromDict(definition?.envFrom, '='),
    cwd: definition?.cwd ?? '',
    headers: linesFromDict(definition?.headers, ': '),
    scope: definition?.scope ?? '',
    redirectUri: definition?.redirectUri ?? '',
    clientId: '',
    clientSecret: '',
  }
}

/** Project a draft back into a stored definition. */
function toDefinition(draft: Draft, previous: McpConnectorDefinition | undefined): McpConnectorDefinition {
  const args = draft.args.split('\n').map(line => line.trim()).filter(line => line !== '')
  return {
    ...previous,
    id: draft.id.trim(),
    label: draft.label.trim(),
    enabled: draft.enabled,
    transport: draft.transport,
    ...draft.command.trim() === '' ? {} : { command: draft.command.trim() },
    ...args.length === 0 ? {} : { args },
    env: dictFromLines(draft.env, '='),
    envFrom: dictFromLines(draft.envFrom, '='),
    ...draft.cwd.trim() === '' ? {} : { cwd: draft.cwd.trim() },
    ...draft.url.trim() === '' ? {} : { url: draft.url.trim() },
    headers: dictFromLines(draft.headers, ':'),
    ...draft.scope.trim() === '' ? {} : { scope: draft.scope.trim() },
    ...draft.redirectUri.trim() === '' ? {} : { redirectUri: draft.redirectUri.trim() },
  }
}

/** Render one labelled field. */
function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): ReactNode {
  return (
    <div className={styles['field']}>
      <span className={styles['fieldLabel']}>{label}</span>
      {children}
      {hint === undefined ? null : <p className={styles['hint']}>{hint}</p>}
    </div>
  )
}

/**
 * Render the add/edit card.
 * @param props - see {@link ConnectorEditorProps}.
 * @returns the card element.
 */
export function ConnectorEditor(props: ConnectorEditorProps): ReactNode {
  const { definition, t } = props
  const [draft, setDraft] = useState<Draft>(() => toDraft(definition))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const editing = definition !== undefined
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft(current => ({ ...current, [key]: value }))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const client = draft.clientId.trim() === ''
        ? undefined
        : {
            clientId: draft.clientId.trim(),
            ...draft.clientSecret === '' ? {} : { clientSecret: draft.clientSecret },
          }
      await props.onSave(toDefinition(draft, definition), client)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['editor']}>
      <div className={styles['editorGrid']}>
        <Field label={t('fieldId')} hint={editing ? undefined : t('fieldIdHint')}>
          <Input
            value={draft.id}
            // The id is the connector's identity: its tool namespace and its
            // credential-record address both derive from it, so renaming one
            // in place would silently orphan a stored sign-in. Delete and
            // re-add instead.
            disabled={editing || busy}
            placeholder="gmail"
            onChange={(event) => { set('id', event.target.value) }}
          />
        </Field>
        <Field label={t('fieldLabel')}>
          <Input
            value={draft.label}
            disabled={busy}
            placeholder="Gmail"
            onChange={(event) => { set('label', event.target.value) }}
          />
        </Field>
        <Field label={t('fieldTransport')}>
          <select
            className={styles['select']}
            value={draft.transport}
            disabled={busy}
            onChange={(event) => { set('transport', event.target.value as McpConnectorTransport) }}
          >
            <option value="streamable-http-oauth">{t('transportOAuth')}</option>
            <option value="streamable-http">{t('transportHttp')}</option>
            <option value="stdio">{t('transportStdio')}</option>
          </select>
        </Field>
      </div>

      {draft.transport === 'stdio'
        ? (
          <div className={styles['editorGrid']}>
            <Field label={t('fieldCommand')}>
              <Input
                value={draft.command}
                disabled={busy}
                placeholder="npx"
                onChange={(event) => { set('command', event.target.value) }}
              />
            </Field>
            <Field label={t('fieldCwd')}>
              <Input
                value={draft.cwd}
                disabled={busy}
                onChange={(event) => { set('cwd', event.target.value) }}
              />
            </Field>
            <Field label={t('fieldArgs')} hint={t('fieldArgsHint')}>
              <textarea
                className={styles['textarea']}
                value={draft.args}
                disabled={busy}
                onChange={(event) => { set('args', event.target.value) }}
              />
            </Field>
            <Field label={t('fieldEnv')} hint={t('fieldEnvHint')}>
              <textarea
                className={styles['textarea']}
                value={draft.env}
                disabled={busy}
                onChange={(event) => { set('env', event.target.value) }}
              />
            </Field>
            <Field label={t('fieldEnvFrom')} hint={t('fieldEnvFromHint')}>
              <textarea
                className={styles['textarea']}
                value={draft.envFrom}
                disabled={busy}
                placeholder="JIRA_API_TOKEN=ATLASSIAN_API_TOKEN"
                onChange={(event) => { set('envFrom', event.target.value) }}
              />
            </Field>
          </div>
        )
        : (
          <>
            <Field label={t('fieldUrl')}>
              <Input
                value={draft.url}
                disabled={busy}
                placeholder="https://gmailmcp.googleapis.com/mcp/v1"
                onChange={(event) => { set('url', event.target.value) }}
              />
            </Field>
            <Field label={t('fieldHeaders')} hint={t('fieldHeadersHint')}>
              <textarea
                className={styles['textarea']}
                value={draft.headers}
                disabled={busy}
                onChange={(event) => { set('headers', event.target.value) }}
              />
            </Field>
          </>
        )}

      {draft.transport !== 'streamable-http-oauth'
        ? null
        : (
          <>
            <div className={styles['editorGrid']}>
              <Field label={t('fieldClientId')} hint={t('fieldClientHint')}>
                <Input
                  value={draft.clientId}
                  disabled={busy}
                  autoComplete="off"
                  placeholder={props.clientConfigured === true ? t('signedIn') : '…apps.googleusercontent.com'}
                  onChange={(event) => { set('clientId', event.target.value) }}
                />
              </Field>
              <Field label={t('fieldClientSecret')}>
                <Input
                  type="password"
                  value={draft.clientSecret}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => { set('clientSecret', event.target.value) }}
                />
              </Field>
            </div>
            <div className={styles['editorGrid']}>
              <Field label={t('fieldScope')} hint={t('fieldScopeHint')}>
                <Input
                  value={draft.scope}
                  disabled={busy}
                  onChange={(event) => { set('scope', event.target.value) }}
                />
              </Field>
              <Field label={t('fieldRedirectUri')} hint={t('fieldRedirectUriHint')}>
                <Input
                  value={draft.redirectUri}
                  disabled={busy}
                  placeholder="http://127.0.0.1:33418/mcp-oauth/callback"
                  onChange={(event) => { set('redirectUri', event.target.value) }}
                />
              </Field>
            </div>
          </>
        )}

      <label className={styles['checkboxRow']}>
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={busy}
          onChange={(event) => { set('enabled', event.target.checked) }}
        />
        {t('fieldEnabled')}
      </label>

      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}

      <div className={styles['editorActions']}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={props.onCancel}>{t('cancel')}</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || draft.id.trim() === ''}
          onClick={() => { void save() }}
        >
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  )
}
