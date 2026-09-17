# dsh-plugins-client-ui-settings-anthropic-subscription

The Anthropic subscription sign-in panel in Settings > Models — a full
replacement for `@deepseek-ai/dsh-client-ui-settings-models`'s own
`settings.section`/`settings.onboarding` registrations, not an addition
through its `settings.models.provider-card`/`settings.models.footer` slots:
those two seats don't reach inside `ProviderEditor`'s own card body (see that
package's own `slot-contract.ts` doc comment), which is where a "sign in"
affordance next to the API-key field has to render. `cordis.patch.yml`
(in `../bundle-anthropic-subscription`) disables the original
`ui-settings-models` row and inserts this one instead — "unplug the original
plugin row, plug in an enhanced one" (see `../../../ARCHITECTURE.md`'s "Why
replace the plugin instead of patching it").

## What's forked vs. reused

Four files are forked because they actually change:
`src/client/ModelsSection.tsx`, `src/client/ProviderEditor.tsx`,
`src/client/index.ts`, and `src/client/locales.ts` (the four `signIn*` keys
are this package's own addition; `deepSeekChatBaseUrl`/
`deepSeekMessagesBaseUrl`/`deepSeekEndpointHint`/`customBaseUrlInvalid`
were mirrored in afterward, added upstream to the same dictionary this
package's own `en`/`zh` must stay a superset of — see that file's own doc
comment). `src/client/AuthorizationPanel.tsx` and
`src/client/authorization-runtime.ts` are new files with no vendored
counterpart. Every other file the forked ones depend on —
`CustomProviderCard`, `DeepSeekModelsEditor`, `DeepSeekOnboardingDialog`,
`WelcomeNotice`, `welcome-store`, `store`, `operations`, `schema-operations`,
`slot-contract`, `EditorFooter`, `ModelListEditor`, `apiKey`,
`ModelsSection.module.css`, `onboarding-copy` — is reused unchanged, imported
as a real value from `@deepseek-ai/dsh-client-ui-settings-models`'s own
`./src/*` export (its own convention; `"./src/*": "./src/*"` in its `exports`
map), never copied.

The fork's own diff against the vendored files it forked is small and
mechanical: thread an `authorization?: IAuthorization` prop from
`ModelsSectionInjected` through `ProviderEditorRenderProps` and
`ProviderEditor`'s own props, derive `authEntry`/`authKeyState` from it with
`useSyncExternalStore`, and render `<AuthorizationPanel>` right after the
API-key field. `AuthorizationRuntime` (backing `IAuthorization`) drives
`ctx.remote.authorization` — the generated Client half of
`dsh-plugins-api-authorization-controller` — mounted at runtime by the
independent `dsh-plugins-client-remotes-anthropic-subscription` plugin (see
that package's own README for why mounting lives in its own dedicated
plugin, not here).

## Porting source and vendor divergence

The `AuthorizationPanel`/`authorization-runtime`/`ProviderEditor`/
`ModelsSection`/`index`/`locales` diff was ported from `yga/deepseek-harness`
(`packages/client/ui-settings-models/src/client/`), a fork snapshot that had
already diverged from this repo's currently vendored
`deepseek-ai/deepseek-harness` submodule pin: `ui-settings-models` was
refactored upstream from a `ModelsWire`/`api` object to a
`ModelsOperations`/`operations` object (`store.ts`'s `ModelsWire` was
removed; `operations.ts` is new), `ModelsSettingsStore`'s constructor takes
`ctx` directly instead of a wire object, `JsonValue` moved from
`@deepseek-ai/dsh-api-remotes/client` to `@deepseek-ai/dsh-util-values`,
`messageOf` was removed (write outcomes carry their own `message` field
instead), and two locale keys (`fetchSearch`, `fetchNoMatches`) were added.
Every forked file here targets the **current** vendored API, not the fork
snapshot's older one — the fork's diff supplied *what* the authorization
feature needs, adapted onto *how* the current `operations`-based API expresses
it.

`src/client/ProviderEditor.tsx`'s `submitLabelKey`/`submitBusyLabelKey`/
`cancelLabelKey` props are typed against `EditorFooter`'s own (vendored,
narrower) locale key union rather than this package's own wider one: those
three props only ever forward to the reused, unforked `EditorFooter`, whose
`t` dictionary never gained this package's four `signIn*` keys, and no caller
here ever passes anything but the shared defaults (`'apply'`/`'applying'`).

## The `authorization/settled` Remote Event

`@deepseek-ai/dsh-authorization` declares `authorization/settled` as an
ordinary Cordis `Events` member (`@mode emit`), forwardable over
`ctx.remote.$on` like any other, but forwarding requires an explicit opt-in:
a `TypertRemoteEventSelection` merge naming it. `dsh-api-remotes`'s own
allowlist doesn't know this event exists, so
`dsh-plugins-api-authorization-controller/src/types.ts` declares its own
merge (`AuthorizationRemoteEvent`) — the same pattern
`@deepseek-ai/dsh-api-session-controller`'s own `remote-events.ts` uses for
its `api-session/*` events. Because `TypertForwardableEvent`/
`TypertRemoteEvent` are ambient global type aliases, this only takes effect
once something in the compiled program actually imports (even type-only)
from both `dsh-plugins-api-authorization-controller`'s `./types` (this
package's own `authorization-runtime.ts` does) **and** from
`@deepseek-ai/dsh-authorization` itself, the package whose own `Events`
merge declares `authorization/settled` in the first place — `src/client/
index.ts` carries a side-effect-only `import type {} from
'@deepseek-ai/dsh-authorization'` for exactly that reason; dropping it makes
`ctx.remote.$on('authorization/settled', ...)` fail to typecheck even though
both `TypertRemoteEventSelection` merges are otherwise correct.

## Build

This package's own `./src/*`-reuse pattern needs one fix in this repo's
shared `../../../tsdown.client-plugin-preset.ts`: its CSS Modules inline
plugin resolved every `.module.css` specifier as a path fragment relative to
the importing file's directory, which only works for a package's own local
imports. A cross-package specifier like `@deepseek-ai/dsh-client-ui-settings-
models/src/client/ModelsSection.module.css` (this package's own `Provider
Editor.tsx`/`ModelsSection.tsx` import) needs real Node module resolution
(honoring that package's `exports` map) instead — `sourceAssetPath` now takes
that path for any source that isn't a relative/absolute specifier. This is a
shared, non-vendor file, so the fix benefits every package that reuses
another's `.module.css` this way, not just this one.

## Known Limitations and Deferred Work

- No unit tests yet, consistent with the rest of this repo's packages at
  this stage (verified today by typecheck + build + a real `dsh web` boot,
  confirming the Models page renders, a provider card opens/closes cleanly,
  and no console errors occur). The sign-in affordance itself has no
  currently-registered authorization flow to exercise against (the
  `dsh-llm-pi-ai` Anthropic flow this package was built for is dormant), so
  `<AuthorizationPanel>` was verified to stay correctly absent rather than to
  render and drive a real flow end-to-end.
