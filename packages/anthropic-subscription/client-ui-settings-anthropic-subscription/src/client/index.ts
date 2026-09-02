/**
 * Models settings and product-onboarding plugin, browser half. It registers
 * the Models page plus the ordered internal-testing and official-DeepSeek
 * onboarding dialogs, whose UI shares this package's modal wrapper. The Host
 * settings and credential contracts stay behind their existing wire APIs.
 *
 * A full replacement for `@deepseek-ai/dsh-client-ui-settings-models`'s own
 * `settings.section`/`settings.onboarding` registrations — "unplug the
 * original plugin row, plug in an enhanced one" (see
 * `../../../../ARCHITECTURE.md`'s "Why replace the plugin instead of
 * patching it", the same pattern
 * `dsh-plugins-client-ui-workspace-enhanced`/`dsh-plugins-client-ui-
 * conversation-enhanced` already use). `ui-settings-models` has no extension
 * slot that reaches where sign-in needs to render (`settings.models.provider-
 * card`/`settings.models.footer` don't reach inside `ProviderEditor`'s own
 * card body — see that package's own `slot-contract.ts` doc comment), so the
 * only options were a vendor patch (forbidden) or this: fork the three files
 * that actually change (`ModelsSection.tsx`, `ProviderEditor.tsx`, this
 * file, plus `locales.ts` for the four new copy keys) and reuse everything
 * else — `CustomProviderCard`, `DeepSeekModelsEditor`, `DeepSeekOnboarding
 * Dialog`, `WelcomeNotice`, `welcome-store`, `store`, `operations`,
 * `schema-operations`, `slot-contract`, `EditorFooter`, `ModelListEditor`,
 * `apiKey`, `ModelsSection.module.css`, `onboarding-copy` — unchanged,
 * imported as real values from that package's own `./src/*` export (its own
 * convention; `"./src/*": "./src/*"` in its `exports` map), not copied.
 *
 * `cordis.patch.yml` disables the original `ui-settings-models` row and
 * inserts this one instead, so no sibling instance of the reused files'
 * shared identity (React contexts, module-level singletons) ever coexists —
 * see `../../../../ARCHITECTURE.md` and this package's own README.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings/credentials invalidations ride the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated ctx.remote.authorization namespace merge —
// mounted at runtime by the independent dsh-plugins-client-remotes-
// anthropic-subscription plugin, not by this package (see that package's
// own README for why mounting lives in its own dedicated plugin).
import type {} from 'dsh-plugins-api-authorization-controller/remote'
// Type-only: pulls @deepseek-ai/dsh-authorization's own Events merge (the
// Host-side `authorization/settled` declaration) into this program — without
// it, dsh-plugins-api-authorization-controller's own TypertRemoteEventSelection
// merge below has nothing to Extract against and `authorization/settled`
// never becomes a legal ctx.remote.$on key.
import type {} from '@deepseek-ai/dsh-authorization'
import { AuthorizationRuntime } from './authorization-runtime.ts'
import type { IAuthorization } from './authorization-runtime.ts'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import {
  DeepSeekOnboardingDialog,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx'
import type {
  DeepSeekOnboardingInjected,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/WelcomeNotice.tsx'
import type { WelcomeNoticeInjected } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/WelcomeNotice.tsx'
import {
  decodeWelcomeSection, WelcomeNoticeStore,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/welcome-store.ts'
import { ModelsSettingsStore } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/store.ts'
import { createModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/operations.ts'
import {
  createSettingsSchemaOperations,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/schema-operations.ts'
import { en, zh, type ModelsKey } from './locales.ts'
import { WELCOME_NOTICE_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-client-ui-settings-models/src/onboarding-copy.ts'

export type { ModelsSectionInjected, ModelsSectionProps } from './ModelsSection.tsx'
export type {
  ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/slot-contract.ts'
export type { ModelsKey } from './locales.ts'
export type { IAuthorization } from './authorization-runtime.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Models page + product-onboarding copy, plus this package's own sign-in keys. */
    'settings.models': ModelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.models'
export type {
  ModelsSettingsState, ProviderDirectoryEntry, ProviderRow,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/store.ts'
export type {
  ModelDiscoveryOutcome, ModelsOperations, SettingsWriteOutcome,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/operations.ts'

/**
 * Refetch the page snapshot only after its first load: an unopened Models
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: ModelsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 *
 * Deliberately NOT listed here: `remote.authorization`. This plugin is
 * itself a top-level loader entry (inserted by `bundle-anthropic-
 * subscription`'s own `cordis.patch.yml`), and this repo's Client boot
 * (`@deepseek-ai/dsh-client-web`'s `assertEntriesActive`) treats ANY
 * top-level entry left "pending" at the end of boot as a FATAL error for
 * the whole app — not a silently-degraded feature — exactly like a thrown
 * exception. A fiber merely nested inside an already-active entry's own
 * `apply()` is invisible to that check, so `remote.authorization` is instead
 * required by a nested `ctx.inject()` call inside `apply()` below, which can
 * stay pending forever (dsh-plugins-client-remotes-anthropic-subscription
 * never installed, or its own mount failed and was caught rather than
 * thrown) without blocking this plugin's own activation. This was
 * discovered by deliberately breaking the mount during development and
 * observing "web boot: 1 entry did not activate" as a second, independent
 * fatal-boot path even after the mounting plugin's own throw was fixed —
 * see `dsh-plugins-client-remotes-anthropic-subscription`'s own README.
 */
export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings',
  'settingsScope', 'settingsSchema',
]

/**
 * Register the Models section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-anthropic-subscription: copy dictionaries')

  // Optional: see the `inject` doc comment above for why `remote.authorization`
  // is required here, nested, instead of in this plugin's own top-level
  // `inject`. `injected()` below reads this mutable capture on every call, so
  // the sign-in panel appears once (if) this nested inject activates, and
  // simply never appears if it doesn't — the rest of the Models section
  // renders and functions normally either way.
  let authorization: IAuthorization | undefined
  void ctx.inject(['remote.authorization'], (scope) => {
    const runtime = new AuthorizationRuntime(scope, scope.remote.authorization)
    authorization = runtime
    scope.effect(() => {
      // authorization/settled rides the generic forwarded-event channel
      // rather than a dedicated HostFrame, so dsh-client-runtime itself never
      // subscribes to it (it only ever calls ctx.remote.$dispatch, never
      // $on); this plugin, already bridging $on for its own refresh needs
      // below, reports the settlement into this runtime instead.
      const dispose = scope.remote.$on('authorization/settled', (key) => { runtime.notifySettled(key) })
      return () => {
        authorization = undefined
        dispose()
      }
    }, 'ui-settings-anthropic-subscription: authorization settlement bridge')
  })

  const schema = createSettingsSchemaOperations(ctx.settingsSchema)
  // Bound once here, where the Remote namespaces are declared in this plugin's
  // own `inject`; the cards receive callbacks and never a context.
  const operations = createModelsOperations(ctx)
  const controller = new ModelsSettingsStore(ctx, schema, ctx.settingsScope.describe())
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
  const injected = (): ModelsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    operations,
    authorization,
    schema,
    t,
  })
  const deepSeekOnboardingInjected = (): DeepSeekOnboardingInjected => ({
    controller,
    hooks: { models: controller.store },
    operations,
    schema,
    t,
  })
  // The scope's own memory mode is what keeps a remote browser process-local,
  // so the store needs no isLoopback branch of its own.
  const welcomeController = new WelcomeNoticeStore(ctx.settingsScope.bind({
    namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    decode: decodeWelcomeSection,
  }))
  const welcomeInjected = (): WelcomeNoticeInjected => ({
    controller: welcomeController,
    hooks: { welcome: welcomeController.store },
    t,
  })

  // Pushed invalidations converge every open surface without polling. The
  // settingsScope injection makes ui-settings activate first, and remote
  // dispatch preserves listener order; its listener therefore starts the
  // mirror refresh before this store joins that refresh. The welcome notice
  // follows its settings scope, so it needs no subscription here.
  ctx.effect(() => {
    const refreshModels = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshModels() }),
      ctx.remote.$on('credentials/reference-updated', refreshModels),
      ctx.remote.$on('llm/adapters-updated', refreshModels),
      ctx.on('connection/reset', refreshModels),
    ]
    return () => {
      welcomeController.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-anthropic-subscription: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'models',
    order: 10,
    label: () => t('nav'),
    inject: injected,
    children: {
      'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
      'settings.models.footer': { kind: 'list', scope: 'root' },
    },
  }, ModelsSection))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'welcome-notice',
    order: -100,
    inject: welcomeInjected,
  }, WelcomeNotice))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'deepseek-official',
    order: 0,
    inject: deepSeekOnboardingInjected,
  }, DeepSeekOnboardingDialog))
}
