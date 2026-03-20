import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import { expandEnvVarsInObject } from "../claude-code-mcp-loader/env-expander"
import { forceReconnect } from "./cleanup"
import { getConnectionType } from "./connection-type"
import { createHttpClient } from "./http-client"
import { createStdioClient } from "./stdio-client"
import type { SkillMcpClientConnectionParams, SkillMcpClientInfo, SkillMcpManagerState } from "./types"

function removeClientIfCurrent(state: SkillMcpManagerState, clientKey: string, client: Client): void {
  const managed = state.clients.get(clientKey)
  if (managed?.client === client) {
    state.clients.delete(clientKey)
  }
}

export async function getOrCreateClient(params: {
  state: SkillMcpManagerState
  clientKey: string
  info: SkillMcpClientInfo
  config: ClaudeCodeMcpServer
}): Promise<Client> {
  const { state, clientKey, info, config } = params

  if (state.disposed) {
    throw new Error(`MCP manager for "${info.sessionID}" has been shut down, cannot create new connections.`)
  }

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
  let currentConnectionPromise!: Promise<Client>
  state.inFlightConnections.set(info.sessionID, (state.inFlightConnections.get(info.sessionID) ?? 0) + 1)
  currentConnectionPromise = (async () => {
    const disconnectGenAtStart = state.disconnectedSessions.get(info.sessionID) ?? 0
    const shutdownGenAtStart = state.shutdownGeneration

    const client = await createClient({ state, clientKey, info, config: expandedConfig })

    const isStale = state.pendingConnections.has(clientKey) && state.pendingConnections.get(clientKey) !== currentConnectionPromise
    if (isStale) {
      removeClientIfCurrent(state, clientKey, client)
      try { await client.close() } catch {}
      throw new Error(`Connection for "${info.sessionID}" was superseded by a newer connection attempt.`)
    }

    if (state.shutdownGeneration !== shutdownGenAtStart) {
      removeClientIfCurrent(state, clientKey, client)
      try { await client.close() } catch {}
      throw new Error(`Shutdown occurred during MCP connection for "${info.sessionID}"`)
    }

    const currentDisconnectGen = state.disconnectedSessions.get(info.sessionID) ?? 0
    if (currentDisconnectGen > disconnectGenAtStart) {
      await forceReconnect(state, clientKey)
      throw new Error(`Session "${info.sessionID}" disconnected during MCP connection setup.`)
    }

    return client
  })()

  state.pendingConnections.set(clientKey, currentConnectionPromise)

  try {
    const client = await currentConnectionPromise
    return client
  } finally {
    if (state.pendingConnections.get(clientKey) === currentConnectionPromise) {
      state.pendingConnections.delete(clientKey)
    }
    const remaining = (state.inFlightConnections.get(info.sessionID) ?? 1) - 1
    if (remaining <= 0) {
      state.inFlightConnections.delete(info.sessionID)
      state.disconnectedSessions.delete(info.sessionID)
    } else {
      state.inFlightConnections.set(info.sessionID, remaining)
    }
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
