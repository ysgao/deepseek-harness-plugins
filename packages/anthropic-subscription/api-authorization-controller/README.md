# dsh-plugins-api-authorization-controller

**Status: confirmed working.** Builds clean (`tsc -b` + `tsdown`, emitting
`lib/typert.host.js`/`lib/typert.remote-client.js` with all five `@Remote`
methods correctly modeled), installs via `dsh plugin --profile <name> add
dsh-plugins-bundle-anthropic-subscription`, and the target profile boots
with the `authorization` Typert namespace registered and zero errors.

A new Host Typert controller that exposes `ctx.authorization` (list
registered flows, describe one, begin/cancel an attempt, stream notices
and prompts) as an RPC surface the client can drive — generic over any
registered flow, not just Anthropic's.

Ports `packages/api/settings-controller/src/authorization.ts` (271 lines)
and its host spec from `yga/deepseek-harness`, without editing
`@deepseek-ai/dsh-api-settings-controller` itself. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
