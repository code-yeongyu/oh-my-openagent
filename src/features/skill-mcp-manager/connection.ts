import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import { expandEnvVarsInObject } from "../claude-code-mcp-loader/env-expander"
import { forceReconnect } from "./cleanup"
import { getConnectionType } from "./connection-type"
import { createHttpClient } from "./http-client"
import { createStdioClient } from "./stdio-client"
import type { SkillMcpClientConnectionParams, SkillMcpClientInfo, SkillMcpManagerState } from "./types"

export async function getOrCreateClient(params: {
  state: SkillMcpManagerState
  clientKey: string
  info: SkillMcpClientInfo
  config: ClaudeCodeMcpServer
}): Promise<Client> {
  const { state, clientKey, info, config } = params

  const existing = state.clients.get(clientKey)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing.client
  }

  // Prevent race condition: if a connection is already in progress, wait for it
  const pending = state.pendingConnections.get(clientKey)
  if (pending) {
    return pending
  }

  const expandedConfig = expandEnvVarsInObject(config)
  const connectionPromise = createClient({ state, clientKey, info, config: expandedConfig })
  state.pendingConnections.set(clientKey, connectionPromise)

  try {
    const client = await connectionPromise
    return client
  } finally {
    state.pendingConnections.delete(clientKey)
  }
}

export async function getOrCreateClientWithRetryImpl(params: {
  state: SkillMcpManagerState
  clientKey: string
  info: SkillMcpClientInfo
  config: ClaudeCodeMcpServer
}): Promise<Client> {
  const { state, clientKey } = params

  try {
    return await getOrCreateClient(params)
  } catch (error) {
    const didReconnect = await forceReconnect(state, clientKey)
    if (!didReconnect) {
      throw error
    }
    return await getOrCreateClient(params)
  }
}

async function createClient(params: {
  state: SkillMcpManagerState
  clientKey: string
  info: SkillMcpClientInfo
  config: ClaudeCodeMcpServer
}): Promise<Client> {
  const { info, config } = params
  const connectionType = getConnectionType(config)

  if (!connectionType) {
    throw new Error(
      `MCP server "${info.serverName}" has no valid connection configuration.\n\n` +
      `The MCP configuration in skill "${info.skillName}" must specify either:\n` +
      `  - A URL for HTTP connection (remote MCP server)\n` +
      `  - A command for stdio connection (local MCP process)\n\n` +
      `Examples:\n` +
      `  HTTP:\n` +
      `    mcp:\n` +
      `      ${info.serverName}:\n` +
      `        url: https://mcp.example.com/mcp\n` +
      `        headers:\n` +
      "          Authorization: Bearer ${API_KEY}\n\n" +
      `  Stdio:\n` +
      `    mcp:\n` +
      `      ${info.serverName}:\n` +
      `        command: npx\n` +
      `        args: [-y, @some/mcp-server]`
    )
  }

  if (connectionType === "http") {
    return await createHttpClient(params satisfies SkillMcpClientConnectionParams)
  }
  return await createStdioClient(params satisfies SkillMcpClientConnectionParams)
}
