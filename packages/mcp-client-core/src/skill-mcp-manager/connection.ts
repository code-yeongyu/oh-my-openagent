import { expandEnvVarsInObject } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/env-expander"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { forceReconnect } from "./cleanup"
import { getConnectionType } from "./connection-type"
import { createHttpClient } from "./http-client"
import { createStdioClient } from "./stdio-client"
import type { McpClient, SkillMcpClientConnectionParams, SkillMcpClientInfo, SkillMcpManagerState } from "./types"
import { EnvironmentGrantPolicy } from "./environment-grant-policy"
import { usesProjectEnvironment } from "./project-env-policy"

function removeClientIfCurrent(state: SkillMcpManagerState, clientKey: string, client: McpClient): void {
  const managed = state.clients.get(clientKey)
  if (managed?.client === client) {
    state.clients.delete(clientKey)
  }
}

const PROJECT_SCOPES = new Set(["project", "opencode-project", "local"])

export async function getOrCreateClient(params: {
  state: SkillMcpManagerState
  clientKey: string
  info: SkillMcpClientInfo
  config: ClaudeCodeMcpServer
  sessionEnv?: Readonly<Record<string, string>>
  cdpUrl?: string
}): Promise<McpClient> {
  const { state } = params
  const disconnectGenAtEntry = state.disconnectedSessions.get(params.info.sessionID) ?? 0
  const shutdownGenAtEntry = state.shutdownGeneration
  state.inFlightConnections.set(params.info.sessionID, (state.inFlightConnections.get(params.info.sessionID) ?? 0) + 1)
  try {
    if (state.disposed) {
      throw new Error(`MCP manager for "${params.info.sessionID}" has been shut down, cannot create new connections.`)
    }
    // Only re-validated or project-scoped declarations await anything before the pending entry is
    // registered; every other server keeps the synchronous registration concurrent callers and
    // disconnects rely on (#10693).
    let info = params.info
    let config = params.config
    let policy: Awaited<ReturnType<EnvironmentGrantPolicy["prepare"]>>
    if (params.info.revalidateDeclaration || usesProjectEnvironment(params.info)) {
      const refreshed = await params.info.revalidateDeclaration?.()
      if (params.info.revalidateDeclaration && !refreshed) throw new Error("The MCP declaration is no longer available.")
      info = refreshed ? { ...params.info, sourcePath: refreshed.sourcePath, sourceKind: refreshed.sourceKind } : params.info
      config = refreshed?.config ?? params.config
      state.environmentPolicy ??= new EnvironmentGrantPolicy(undefined, undefined, async (identity) => {
        for (const key of state.clients.keys()) if (key.includes(`::identity=${identity}::`)) await forceReconnect(state, key)
      })
      policy = await state.environmentPolicy.prepare(info, config, params.sessionEnv)
    }
    const clientKey = policy ? `${params.clientKey}::identity=${policy.identity}::policy=${policy.digest}` : params.clientKey
    if (state.shutdownGeneration !== shutdownGenAtEntry ||
      (state.disconnectedSessions.get(info.sessionID) ?? 0) !== disconnectGenAtEntry) {
      throw new Error(`Session "${info.sessionID}" disconnected during MCP policy resolution.`)
    }

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

    const isTrusted = info.scope === "host" ? info.hostUserTrusted === true : !PROJECT_SCOPES.has(info.scope ?? "")
    const resolvedConfig = policy?.config ?? expandEnvVarsInObject(config, { trusted: isTrusted })
    const expandedConfig = params.cdpUrl
      ? { ...resolvedConfig, args: [...(resolvedConfig.args ?? []), "--cdp-endpoint", params.cdpUrl] }
      : resolvedConfig
    let currentConnectionPromise!: Promise<McpClient>
    currentConnectionPromise = (async () => {
      const disconnectGenAtStart = disconnectGenAtEntry
      const shutdownGenAtStart = shutdownGenAtEntry

      const client = await createClient({ state, clientKey, info, config: expandedConfig, environment: policy?.environment, policySignal: policy?.signal })
      if (policy && state.environmentPolicy?.version(policy.identity) !== policy.version) {
        await forceReconnect(state, clientKey)
        throw new Error("MCP environment policy changed during connection; retry with the current grant snapshot.")
      }

      const isStale = state.pendingConnections.has(clientKey) && state.pendingConnections.get(clientKey) !== currentConnectionPromise
      if (isStale) {
        removeClientIfCurrent(state, clientKey, client)
        try {
          await client.close()
        } catch (error) {
          if (!(error instanceof Error)) {
            throw error
          }
        }
        throw new Error(`Connection for "${info.sessionID}" was superseded by a newer connection attempt.`)
      }

      if (state.shutdownGeneration !== shutdownGenAtStart) {
        removeClientIfCurrent(state, clientKey, client)
        try {
          await client.close()
        } catch (error) {
          if (!(error instanceof Error)) {
            throw error
          }
        }
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
    }
  } finally {
    const remaining = (state.inFlightConnections.get(params.info.sessionID) ?? 1) - 1
    if (remaining <= 0) {
      state.inFlightConnections.delete(params.info.sessionID)
      state.disconnectedSessions.delete(params.info.sessionID)
    } else {
      state.inFlightConnections.set(params.info.sessionID, remaining)
    }
  }
}

export async function getOrCreateClientWithRetryImpl(params: {
  state: SkillMcpManagerState
  clientKey: string
  info: SkillMcpClientInfo
  config: ClaudeCodeMcpServer
  sessionEnv?: Readonly<Record<string, string>>
  cdpUrl?: string
}): Promise<McpClient> {
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
  environment?: Record<string, string>
  policySignal?: AbortSignal
}): Promise<McpClient> {
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
