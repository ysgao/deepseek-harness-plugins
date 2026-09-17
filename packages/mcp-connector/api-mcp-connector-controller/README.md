# dsh-plugins-api-mcp-connector-controller

Host Typert controller exposing the MCP connector registry and its sign-in
flows as the `mcpConnectors` Remote namespace, auto-discovered by
`@deepseek-ai/dsh-typert-loader`.

`authorize` resolves only once the whole attempt settles — a human clicking
through a consent page can take minutes — so its notices and prompts never ride
the RPC response. They ride `follow` instead: one stream shared by every
connected page, where `prompt-requested` replays as a reconnect baseline, so
any tab can answer a sign-in another tab started.

## Why its own feed instead of reusing the authorization controller

`dsh-plugins-api-authorization-controller` is generic over the whole
`ctx.authorization` registry and would serve this perfectly well — but reusing
it means sharing the plugin row that mounts it, and two bundles that each
insert that row into one profile collide on the service name. A second,
connector-scoped stream here is a few dozen lines; making two bundles' install
order load-bearing for something as central as sign-in is not a trade worth
taking. The two controllers coexist with no conflict.

## Reserved Remote method names

The Client gateway installs every Remote method as a property of its namespace
*service* and refuses any name that shadows one of that service's own members.
The reserved set is `ctx`, `empty`, `invokeRemote`, `methods`, `name`,
`namespace`, plus `RemoteNamespaceService`'s own methods —
`assertMethodAvailable`, `has`, `install`, `installDirect`, `installScoped`,
and **`remove`**.

This is why the delete operation is `removeConnector`. Nothing catches a
collision until a browser boots: the Host mounts fine, the Client `$mount`
throws `client api: method "…/remove" conflicts with its namespace service`,
the mounting plugin catches and logs it per this repo's isolation rules, and
the only visible symptom is a settings page that never appears. Check a new
`@Remote` method's name against that list before adding it.

## Typert generator constraints

A type crossing the wire is named through its declaring package's export map,
and the generator resolves that only for packages listed **top-level** in
`tsconfig.host.json`. For any other package it emits a bare name with no
import — exactly as `dsh-plugins-api-authorization-controller` already does for
`AuthorizationEntry` and `CredentialKey`, and harmless for the same reason
(consumers import those types themselves, and `skipLibCheck` covers the
generated `.d.ts`).

`connector-registry` and `mcp-client-oauth` are therefore *not* listed
top-level in `tsconfig.host.json`; they are still typechecked and built through
this package's own project references. Listing them made the generator crash
outright — `getExportsOfModule` on an undefined module symbol — while resolving
a type whose sources were not in the filtered program.

For the same naming reason, avoid a mapped type (`Partial<T>`) or an anonymous
object literal in a `@Remote` signature; declare a named interface instead, as
`McpSignInOutcome` does.
