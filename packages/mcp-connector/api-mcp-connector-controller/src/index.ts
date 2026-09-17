/**
 * Host Typert controller exposing the MCP connector registry and its sign-in
 * flows as an RPC surface, mounted as an independent top-level plugin and
 * auto-discovered by `@deepseek-ai/dsh-typert-loader`.
 *
 * @module dsh-plugins-api-mcp-connector-controller
 */
export { McpConnectorController } from './controller.ts'
export { default } from './controller.ts'
export type * from './types.ts'
