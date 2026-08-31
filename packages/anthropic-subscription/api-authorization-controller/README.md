# dsh-plugins-api-authorization-controller

**Status: Phase 0 scaffold — not yet implemented.**

A new Host Typert controller that exposes `ctx.authorization` (list
registered flows, describe one, begin/cancel an attempt, stream notices
and prompts) as an RPC surface the client can drive — generic over any
registered flow, not just Anthropic's.

Ports `packages/api/settings-controller/src/authorization.ts` (271 lines)
and its host spec from `yga/deepseek-harness`, without editing
`@deepseek-ai/dsh-api-settings-controller` itself. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
