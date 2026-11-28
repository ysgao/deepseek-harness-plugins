/**
 * Models settings and product-onboarding plugin, browser half. It registers
 * the Models page plus the ordered preview-notice and official-DeepSeek
 * onboarding dialogs, whose UI shares this package's modal wrapper. The Host
 * settings and credential contracts stay behind their existing wire APIs.
 *
 * A full replacement for @deepseek-ai/dsh-client-ui-settings-models's own
 * settings.section/settings.onboarding registrations -- "unplug the
 * original plugin row, plug in an enhanced one" (see
 * ../../../../ARCHITECTURE.md's "Why replace the plugin instead of
 * patching it", the same pattern dsh-plugins-client-ui-workspace-enhanced/
 * dsh-plugins-client-ui-conversation-enhanced already use). ui-settings-models
 * has no extension slot that reaches where sign-in needs to render
 * (settings.models.provider-card/settings.models.footer don't reach inside
 * ProviderEditor's own card body -- see that package's own slot-contract.ts
 * doc comment), so the only options were a vendor patch (forbidden) or
 * this: fork the three files that actually change (ModelsSection.tsx,
 * ProviderEditor.tsx, this file, plus locales.ts for the four new copy
 * keys) and reuse everything else -- CustomProviderCard,
 * DeepSeekModelsEditor, DeepSeekOnboardingDialog, WelcomeNotice,
 * welcome-store, store, operations, schema-operations, slot-contract,
 * EditorFooter, FoldSection, ModelListEditor, ModelReasoningEfforts,
 * RetryPolicyEditor, ApiKeyInput, useInvalidFocus, protocol-label,
 * protocol-rules, apiKey, ModelsSection.module.css, onboarding-copy --
 * unchanged, imported as real values from that package's own ./src/*
 * export (its own convention; "./src/*": "./src/*" in its exports map),
 * not copied.
 *
 * cordis.patch.yml disables the original ui-settings-models row and
 * inserts this one instead, so no sibling instance of the reused files'
 * shared identity (React contexts, module-level singletons) ever coexists --
 * see ../../../../ARCHITECTURE.md and this package's own README.
 *
 * Resilience (see ../../../../ARCHITECTURE.md's "Plugin isolation"):
 * every ctx.slots.register() call below registers at priority: -1, one
 * lower than the pristine plugin's own default (0) -- if a bundle
 * install-order violation ever leaves the pristine ui-settings-models row
 * active too, both registrations land instead of the second one throwing,
 * and this one wins deterministically (lowest priority renders). Each of
 * the three slot registrations is also individually try/catch-guarded: a
 * failure there degrades only that one row rather than crashing the app.
 *
 * Unlike dsh-plugins-client-ui-workspace-enhanced/-conversation-
 * enhanced, apply() does NOT fall back to calling the pristine
 * ui-settings-models plugin's own apply(ctx) if enhanced setup fails --
 * it logs and gives up instead, leaving the Models section entirely absent
 * (still never crashing the whole app). That fallback is deliberately not
 * implemented here: this package's own declare module merge widens
 * LocaleNamespaceMap['settings.models'] with four extra signIn* keys
 * (see locales.ts), and the pristine package's own apply is defined
 * directly in its ./src/client/index.ts -- the same file that declares
 * ITS OWN, narrower version of that exact merge. Importing that file for
 * its apply value, by any static import form, pulls its ambient
 * declare module block into this program too, and TypeScript rejects two
 * non-identical declarations of the same augmented property
 * (LocaleNamespaceMap['settings.models']) as a compile error -- there is
 * no value-only import that avoids this for an ambient declaration. A
 * dynamic import() with a non-literal specifier sidesteps the type
 * conflict but is not a real fix: this package ships as a browser
 * closure-factory bundle (window.__ModuleLoader__.load({id, factory}),
 * ../../../../tsdown.client-plugin-preset.ts), which has no bare-specifier
 * or .ts-extension resolution mechanism at runtime for an arbitrary
 * module path -- only for this bundle's own statically-known dependencies.
 *
 * Vendor pin 841f76d3 (tag dsh-v0.2.3-alpha.3) note: the pristine plugin's
 * own apply() gained a second parameter,
 * `config: SyncedConfig<ModelsConfig>` (Host-synced "offer the browser
 * credential-onboarding step automatically" choice, replacing the old
 * page-global `__DSH_MODELS_ONBOARDING__` mechanism this file used to
 * read, which vendor removed outright -- `onboarding-config.ts` no
 * longer exists upstream). That sync channel is correlated by the
 * *package name* of the Client entry against a matching Host-side entry
 * of the SAME package name that declares the Config schema (see the
 * pristine package's own `src/index.ts`, which exists for exactly that
 * declaration and nothing else). This package's own `src/index.ts` (not
 * forked; out of this row's tracked fork list) declares no such schema,
 * and wiring one up is a Host-side change this package's own scope does
 * not reach from here. Rather than depend on a sync channel that would
 * silently never deliver a value for this renamed entry (and risk a
 * crash reading a field off whatever empty config object cordis hands an
 * unmatched entry), `automatic` below is computed locally with the exact
 * same effective default the pristine schema declares
 * (`credentialOnboarding: true`) -- so behavior is unchanged from today
 * for every deployment that never configured a non-default value through
 * that channel (which is every deployment using this replacement, since
 * the channel was never reachable for the ORIGINAL row either without
 * the Host explicitly pointing it at this package's name). A real fix
 * threading a live value through would additionally touch this
 * package's own Host-side `src/index.ts` to declare a matching `Config`
 * schema -- tracked as follow-up, not attempted here since it is outside
 * the four files this row's fork list covers.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings/credentials invalidations ride the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated ctx.remote.authorization namespace merge --
// mounted at runtime by the independent dsh-plugins-client-remotes-
// anthropic-subscription plugin, not by this package (see that package's
// own README for why mounting lives in its own dedicated plugin).
import type {} from 'dsh-plugins-api-authorization-controller/remote'
// Type-only: pulls @deepseek-ai/dsh-authorization's own Events merge (the
// Host-side authorization/settled declaration) into this program -- without
// it, dsh-plugins-api-authorization-controller's own TypertRemoteEventSelection
// merge below has nothing to Extract against and authorization/settled
// never becomes a legal ctx.remote.$on key.
import type {} from '@deepseek-ai/dsh-authorization'
import { AuthorizationRuntime } from './authorization-runtime.ts'
import type { IAuthorization } from './authorization-runtime.ts'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { DeepSeekOnboardingDialog } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx'
import type {
  DeepSeekOnboardingInjected,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/WelcomeNotice.tsx'
import type { WelcomeNoticeInjected } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/WelcomeNotice.tsx'
import { WelcomeNoticeStore } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/welcome-store.ts'
import { ModelsSettingsStore } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/store.ts'
import { createModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/operations.ts'
import {
  createSettingsSchemaOperations,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/schema-operations.ts'
import { en, zh, type ModelsKey } from './locales.ts'
import {
  de as vendorDe, es as vendorEs, fr as vendorFr, ja as vendorJa, pt as vendorPt, ru as vendorRu,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/locales.ts'
import { WELCOME_NOTICE_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-client-ui-settings-models/src/onboarding-copy.ts'

export type { ModelsSectionInjected, ModelsSectionProps } from './ModelsSection.tsx'
export type {
  ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/slot-contract.ts'
export type { ModelsKey } from './locales.ts'
export type { IAuthorization } from './authorization-runtime.ts'

declare module '@deepseek-ai/dsh-client-ui-slots/client' {
  interface LocaleNamespaceMap {
    /** The Models page + product-onboarding copy, plus this package's own sign-in keys. */
    'settings.models': ModelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.models'

/**
 * Credential-onboarding choice while no live Host-synced value reaches this
 * renamed entry (see this file's own doc comment) -- equals the pristine
 * package's own Config schema default (`credentialOnboarding.default(true)`),
 * so behavior is unchanged from what this row has always effectively done.
 */
const ABSENT_CREDENTIAL_ONBOARDING = true

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
 * constrained; registration depends on each slot through slots.inject().
 *
 * Deliberately NOT listed here: remote.authorization. This plugin is
 * itself a top-level loader entry (inserted by bundle-anthropic-
 * subscription's own cordis.patch.yml), and this repo's Client boot
 * (@deepseek-ai/dsh-client-web's assertEntriesActive) treats ANY
 * top-level entry left "pending" at the end of boot as a FATAL error for
 * the whole app -- not a silently-degraded feature -- exactly like a thrown
 * exception. A fiber merely nested inside an already-active entry's own
 * apply() is invisible to that check, so remote.authorization is instead
 * required by a nested ctx.inject() call inside apply() below, which can
 * stay pending forever (dsh-plugins-client-remotes-anthropic-subscription
 * never installed, or its own mount failed and was caught rather than
 * thrown) without blocking this plugin's own activation. This was
 * discovered by deliberately breaking the mount during development and
 * observing "web boot: 1 entry did not activate" as a second, independent
 * fatal-boot path even after the mounting plugin's own throw was fixed --
 * see dsh-plugins-client-remotes-anthropic-subscription's own README.
 */
export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings', 'remote.session',
  'configForms', 'settingsSchema',
]

/**
 * This fork's four `signIn*` keys (see `en`/`zh` in `./locales.ts`), in
 * English, layered on top of each of vendor's own `ja`/`es`/`fr`/`de`/`ru`/`pt`
 * dictionaries (imported unforked, directly from `dsh-client-ui-settings-models`).
 * Registering vendor's own richer translations for every language it ships,
 * rather than falling back to raw keys for the whole Models section in any
 * language but English/Chinese just because this row was replaced, is a
 * deliberate choice (see this row's `adds` entry in
 * scripts/replacement-parity.json) — but `LocaleDictOf<'settings.models'>`
 * requires every registered dictionary to carry this fork's own keys too, and
 * nobody has translated them into these six languages. English is the
 * honest placeholder until someone does; not silently wrong, not a build
 * break either.
 */
const signInEnglishFallback = {
  signInChooseMethod: en.signInChooseMethod,
  signInSubmit: en.signInSubmit,
  signInDecline: en.signInDecline,
  signInCancel: en.signInCancel,
}
const ja = { ...vendorJa, ...signInEnglishFallback }
const es = { ...vendorEs, ...signInEnglishFallback }
const fr = { ...vendorFr, ...signInEnglishFallback }
const de = { ...vendorDe, ...signInEnglishFallback }
const ru = { ...vendorRu, ...signInEnglishFallback }
const pt = { ...vendorPt, ...signInEnglishFallback }

/**
 * Register the Models section once the settings.section declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  let injected: () => ModelsSectionInjected
  let deepSeekOnboardingInjected: () => DeepSeekOnboardingInjected
  let welcomeInjected: () => WelcomeNoticeInjected
  let t: ModelsSectionInjected['t']
  const nativeShell = 'dshDesktop' in globalThis
  // Whether the official-DeepSeek step opens on its own; the native shell owns its own onboarding.
  // See this file's own doc comment for why this does not follow a live Host-synced config value.
  const automatic = {
    getSnapshot: () => !nativeShell && ABSENT_CREDENTIAL_ONBOARDING,
    subscribe: () => () => {},
  }
  try {
    ctx.effect(
      () => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }),
      'ui-settings-anthropic-subscription: copy dictionaries',
    )

    // Optional: see the inject doc comment above for why remote.authorization
    // is required here, nested, instead of in this plugin's own top-level
    // inject. injected() below reads this mutable capture on every call, so
    // the sign-in panel appears once (if) this nested inject activates, and
    // simply never appears if it doesn't -- the rest of the Models section
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
    // own inject; the cards receive callbacks and never a context.
    const operations = createModelsOperations(ctx)
    const controller = new ModelsSettingsStore(ctx, schema, ctx.configForms.describe())
    // Registration-time text (the nav label thunk) and the inject faces share
    // one bound translate; copy freshness rides the locale revision.
    t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
    injected = (): ModelsSectionInjected => ({
      controller,
      hooks: { snapshot: controller.store },
      operations,
      authorization,
      schema,
      t,
    })
    deepSeekOnboardingInjected = (): DeepSeekOnboardingInjected => ({
      track: (name, attributes) => ctx.get('productAnalytics')?.track(name, attributes),
      controller,
      hooks: { models: controller.store, automatic },
      operations,
      schema,
      t,
    })
    // The scope's own memory mode is what keeps a remote browser process-local,
    // so the store needs no isLoopback branch of its own.
    const welcomeController = new WelcomeNoticeStore(
      ctx.configForms.get<Record<string, unknown>>(WELCOME_NOTICE_SETTINGS_NAMESPACE),
    )
    welcomeInjected = (): WelcomeNoticeInjected => ({
      controller: welcomeController,
      hooks: { welcome: welcomeController.store },
      t,
    })

    // Pushed invalidations converge every open surface without polling. The
    // configForms injection makes ui-settings activate first, and remote
    // dispatch preserves listener order; its listener therefore starts the
    // mirror refresh before this store joins that refresh. The welcome notice
    // follows its settings scope, so it needs no subscription here.
    ctx.effect(() => {
      const refreshModels = (): void => { refreshIfLoaded(controller) }
      const disposers = [
        ctx.remote.$on('settings/document-updated', () => { refreshModels() }),
        ctx.remote.$on('credentials/record-updated', refreshModels),
        ctx.remote.$on('credentials/reference-updated', refreshModels),
        ctx.remote.$on('llm/adapters-updated', refreshModels),
        ctx.on('connection/reset', refreshModels),
      ]
      return () => {
        welcomeController.dispose()
        for (const dispose of disposers) dispose()
      }
    }, 'ui-settings-anthropic-subscription: pushed invalidations')
  } catch (error) {
    // No pristine-apply fallback is possible here -- see this file's own
    // doc comment. Logging and giving up still means only the Models
    // section is absent, never a crash of the whole Client boot.
    ctx.logger.error(
      'dsh-plugins-client-ui-settings-anthropic-subscription: enhanced setup failed -- the Models settings section will be unavailable',
    )
    ctx.logger.error(error)
    return
  }

  ctx.slots.inject('settings.section', () => {
    try {
      return ctx.slots.register({
        name: 'settings.section',
        id: 'models',
        // Lower than the pristine ui-settings-models row's default priority
        // (0): if a bundle install-order violation ever leaves that row
        // active too (see ARCHITECTURE.md's "Plugin isolation"), both
        // registrations land instead of the second one throwing, and this
        // one wins deterministically (lowest priority renders).
        priority: -1,
        order: 10,
        label: () => t('nav'),
        inject: injected,
        children: {
          'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
          'settings.models.footer': { kind: 'list', scope: 'root' },
        },
      }, ModelsSection)
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-settings-anthropic-subscription: failed to register the settings.section models row')
      ctx.logger.error(error)
      return []
    }
  })
  if (!nativeShell) {
    ctx.slots.inject('settings.onboarding', () => {
      try {
        return ctx.slots.register({
          name: 'settings.onboarding',
          id: 'welcome-notice',
          priority: -1,
          order: -100,
          inject: welcomeInjected,
        }, WelcomeNotice)
      } catch (error) {
        ctx.logger.error('dsh-plugins-client-ui-settings-anthropic-subscription: failed to register the welcome-notice onboarding entry')
        ctx.logger.error(error)
        return []
      }
    })
  }
  ctx.slots.inject('settings.onboarding', () => {
    try {
      return ctx.slots.register({
        name: 'settings.onboarding',
        id: 'deepseek-official',
        priority: -1,
        children: { 'settings.models.sign-in': { kind: 'single', scope: 'root' } },
        order: 0,
        inject: deepSeekOnboardingInjected,
      }, DeepSeekOnboardingDialog)
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-settings-anthropic-subscription: failed to register the deepseek-official onboarding entry')
      ctx.logger.error(error)
      return []
    }
  })
}
