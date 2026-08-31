# dsh-plugins-llm-anthropic-subscription

**Status: Phase 0 scaffold — not yet implemented.**

Registers one `AuthorizationFlow` with `ctx.authorization.registerFlow()`
for an Anthropic subscription (Claude Pro/Max OAuth) credential, using
`@deepseek-ai/dsh-llm-pi-ai`'s existing Anthropic-capable login mechanics
(`packages/llm/llm-pi-ai/src/{auth,login}.ts`, already upstream and
unmodified by `yga/deepseek-harness`) to run the OAuth exchange and commit
the credential record.

This is new code — the fork's equivalent logic already lived mostly inside
`llm-pi-ai` itself. `ctx.authorization`'s own module doc documents this
exact registration pattern (see its JSDoc example), so no edit to
`@deepseek-ai/dsh-authorization` is needed. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
