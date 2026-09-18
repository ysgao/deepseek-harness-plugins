/**
 * Copy dictionaries for the MCP connectors settings section.
 *
 * This section is additive — it registers a new `settings.section` entry
 * rather than replacing one — so this dictionary answers to nothing but
 * itself, unlike the Models fork's, which must stay a superset of the vendor
 * dictionary it stands in for.
 *
 * @module dsh-plugins-client-ui-settings-mcp-connector/locales
 */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'MCP connectors',
  title: 'MCP connectors',
  intro:
    'Connect Model Context Protocol servers to make their tools available to the agent. '
    + 'A remote server that uses OAuth is signed in here and keeps itself signed in afterwards.',
  empty: 'No connectors yet.',
  add: 'Add connector',
  addTitle: 'Add a connector',
  editTitle: 'Edit {connector}',
  edit: 'Edit',
  remove: 'Delete',
  removeTitle: 'Delete {connector}?',
  removeDescription: 'Deleting {connector} removes its configuration and any stored sign-in. Its tools stop being available immediately.',
  removeConfirm: 'Delete {connector}',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  close: 'Close',
  retry: 'Retry',
  loadFailed: 'Loading the connector list failed',

  fieldId: 'Connector id',
  fieldIdHint: 'Letters, digits, - and _ only. Its tools appear to the agent as mcp__<id>__<tool>.',
  fieldLabel: 'Display name',
  fieldTransport: 'Transport',
  fieldUrl: 'Server URL',
  fieldCommand: 'Command',
  fieldArgs: 'Arguments',
  fieldArgsHint: 'One per line.',
  fieldEnv: 'Environment',
  fieldEnvHint: 'One KEY=VALUE per line. Stored in clear — never put a token here.',
  fieldEnvFrom: 'Environment from credentials',
  fieldEnvFromHint:
    'One VARIABLE=CREDENTIAL per line. The credential is named here and its value is read from the '
    + 'credential store or the environment at connect time, so no secret is written to the settings document.',
  fieldCwd: 'Working directory',
  fieldHeaders: 'Headers',
  fieldHeadersHint: 'One Name: value per line.',
  fieldScope: 'Scopes',
  fieldScopeHint: 'Leave blank to request what the server publishes.',
  fieldRedirectUri: 'Redirect URI',
  fieldRedirectUriHint: 'Must match a redirect URI registered with the OAuth client, exactly.',
  fieldClientId: 'OAuth client id',
  fieldClientSecret: 'OAuth client secret',
  fieldClientHint:
    'Stored with the tokens in the credential store, never in the settings document. '
    + 'Google issues no client automatically, so a client registered in a Google Cloud project is required.',
  fieldEnabled: 'Enabled',

  transportOAuth: 'Remote (OAuth)',
  transportHttp: 'Remote (static headers)',
  transportStdio: 'Local (stdio)',

  stateConnected: 'Connected',
  stateFailed: 'Not connected',
  stateDisabled: 'Disabled',
  toolCount: '{count} tools',
  toolCountNone: 'No tools yet',

  signIn: 'Sign in',
  signInAgain: 'Sign in again',
  signOut: 'Sign out',
  signedIn: 'Signed in',
  signedInRenewing: 'Signed in — renews automatically',
  signedInNoRefresh: 'Signed in — will need signing in again when the token expires',
  notSignedIn: 'Not signed in',
  needsClient:
    'No OAuth client stored yet. A server that supports dynamic registration creates one when you sign in; '
    + 'one that does not needs a client id and secret filled in below.',
  signInCancel: 'Cancel sign-in',
  signInSubmit: 'Submit',
  signInDecline: 'Skip',
  signInWaiting: 'Waiting for you to finish in the browser…',
}

/** Chinese strings; key set identical to {@link en}. */
export const zh: Record<keyof typeof en, string> = {
  nav: 'MCP 连接器',
  title: 'MCP 连接器',
  intro: '连接 Model Context Protocol 服务器，将其工具提供给智能体。使用 OAuth 的远程服务器在此登录，登录后会自动保持。',
  empty: '尚未配置连接器。',
  add: '添加连接器',
  addTitle: '添加连接器',
  editTitle: '编辑 {connector}',
  edit: '编辑',
  remove: '删除',
  removeTitle: '删除 {connector}？',
  removeDescription: '删除 {connector} 会移除其配置和已保存的登录信息，其工具将立即不可用。',
  removeConfirm: '删除 {connector}',
  cancel: '取消',
  save: '保存',
  saving: '保存中…',
  close: '关闭',
  retry: '重试',
  loadFailed: '加载连接器列表失败',

  fieldId: '连接器 ID',
  fieldIdHint: '仅限字母、数字、- 和 _。其工具对智能体显示为 mcp__<id>__<tool>。',
  fieldLabel: '显示名称',
  fieldTransport: '传输方式',
  fieldUrl: '服务器地址',
  fieldCommand: '命令',
  fieldArgs: '参数',
  fieldArgsHint: '每行一个。',
  fieldEnv: '环境变量',
  fieldEnvHint: '每行一个 KEY=VALUE。以明文保存 —— 请勿在此填写令牌。',
  fieldEnvFrom: '来自凭据的环境变量',
  fieldEnvFromHint: '每行一个 变量=凭据名。此处只写凭据的名称，其值在连接时从凭据存储或环境中读取，因此设置文档中不会写入任何密钥。',
  fieldCwd: '工作目录',
  fieldHeaders: '请求头',
  fieldHeadersHint: '每行一个 Name: value。',
  fieldScope: '授权范围',
  fieldScopeHint: '留空则使用服务器公布的范围。',
  fieldRedirectUri: '回调地址',
  fieldRedirectUriHint: '必须与 OAuth 客户端注册的回调地址完全一致。',
  fieldClientId: 'OAuth 客户端 ID',
  fieldClientSecret: 'OAuth 客户端密钥',
  fieldClientHint: '与令牌一同保存在凭据存储中，不会写入设置文档。Google 不支持自动注册客户端，需要在 Google Cloud 项目中注册。',
  fieldEnabled: '启用',

  transportOAuth: '远程（OAuth）',
  transportHttp: '远程（静态请求头）',
  transportStdio: '本地（stdio）',

  stateConnected: '已连接',
  stateFailed: '未连接',
  stateDisabled: '已停用',
  toolCount: '{count} 个工具',
  toolCountNone: '暂无工具',

  signIn: '登录',
  signInAgain: '重新登录',
  signOut: '退出登录',
  signedIn: '已登录',
  signedInRenewing: '已登录 — 将自动续期',
  signedInNoRefresh: '已登录 — 令牌过期后需要重新登录',
  notSignedIn: '未登录',
  needsClient: '尚未保存 OAuth 客户端。支持动态注册的服务器会在登录时自动创建；不支持的则需在下方填写客户端 ID 与密钥。',
  signInCancel: '取消登录',
  signInSubmit: '提交',
  signInDecline: '跳过',
  signInWaiting: '请在浏览器中完成登录…',
}

/** Every copy key this section owns. */
export type McpConnectorKey = keyof typeof en
