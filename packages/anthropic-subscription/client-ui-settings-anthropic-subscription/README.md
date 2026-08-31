# dsh-plugins-client-ui-settings-anthropic-subscription

**Status: Phase 0 scaffold — not yet implemented.**

The Anthropic subscription sign-in panel in Settings > Models, registered
into `@deepseek-ai/dsh-client-ui-settings-models`'s existing
`settings.models.provider-card` / `settings.models.footer` slots. That
package's own `slot-contract.ts` documents these as *"the two seats through
which a plugin distributed outside this repository adds UI to the Models
settings section without editing it"* — exactly this package's job.

Ports `packages/client/ui-settings-models/src/client/
{AuthorizationPanel.tsx,authorization-runtime.ts}` (+ tests) from
`yga/deepseek-harness`. See [`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
