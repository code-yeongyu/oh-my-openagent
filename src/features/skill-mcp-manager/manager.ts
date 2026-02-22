import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Prompt, Resource, Tool } from "@modelcontextprotocol/sdk/types.js"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import { disconnectAll, disconnectSession, forceReconnect } from "./cleanup"
import { getOrCreateClient, getOrCreateClientWithRetryImpl } from "./connection"
import { handleStepUpIfNeeded } from "./oauth-handler"
import type { SkillMcpClientInfo, SkillMcpManagerState, SkillMcpServerContext } from "./types"

export class SkillMcpManager {
  private readonly state: SkillMcpManagerState = {
    clients: new Map(),
    pendingConnections: new Map(),
    authProviders: new Map(),
    cleanupRegistered: false,
    cleanupInterval: null,
    cleanupHandlers: [],
    idleTimeoutMs: 5 * 60 * 1000,
  }

  private getClientKey(info: SkillMcpClientInfo): string {
    return `${info.sessionID}:${info.skillName}:${info.serverName}`
  }

  async getOrCreateClient(info: SkillMcpClientInfo, config: ClaudeCodeMcpServer): Promise<Client> {
    const clientKey = this.getClientKey(info)
    return await getOrCreateClient({
      state: this.state,
      clientKey,
      info,
      config,
    })
  }

  async disconnectSession(sessionID: string): Promise<void> {
    await disconnectSession(this.state, sessionID)
  }

  async disconnectAll(): Promise<void> {
    await disconnectAll(this.state)
  }

  async listTools(info: SkillMcpClientInfo, context: SkillMcpServerContext): Promise<Tool[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.listTools()
    return result.tools
  }

  async listResources(info: SkillMcpClientInfo, context: SkillMcpServerContext): Promise<Resource[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.listResources()
    return result.resources
  }

  async listPrompts(info: SkillMcpClientInfo, context: SkillMcpServerContext): Promise<Prompt[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.listPrompts()
    return result.prompts
  }

  async callTool(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext,
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return await this.withOperationRetry(info, context.config, async (client) => {
      const result = await client.callTool({ name, arguments: args })
      return result.content
    })
  }

  async readResource(info: SkillMcpClientInfo, context: SkillMcpServerContext, uri: string): Promise<unknown> {
    return await this.withOperationRetry(info, context.config, async (client) => {
      const result = await client.readResource({ uri })
      return result.contents
    })
  }

  async getPrompt(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext,
    name: string,
    args: Record<string, string>
  ): Promise<unknown> {
    return await this.withOperationRetry(info, context.config, async (client) => {
      const result = await client.getPrompt({ name, arguments: args })
      return result.messages
    })
  }

  private async withOperationRetry<T>(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer,
    operation: (client: Client) => Promise<T>
  ): Promise<T> {
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.getOrCreateClientWithRetry(info, config)
        return await operation(client)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const errorMessage = lastError.message.toLowerCase()

        const stepUpHandled = await handleStepUpIfNeeded({
          error: lastError,
          config,
          authProviders: this.state.authProviders,
        })
        if (stepUpHandled) {
          await forceReconnect(this.state, this.getClientKey(info))
          continue
        }

        if (!errorMessage.includes("not connected")) {
          throw lastError
        }

        if (attempt === maxRetries) {
          throw new Error(`Failed after ${maxRetries} reconnection attempts: ${lastError.message}`)
        }

        await forceReconnect(this.state, this.getClientKey(info))
      }
    }

    throw lastError ?? new Error("Operation failed with unknown error")
  }

  // NOTE: tests spy on this exact method name via `spyOn(manager as any, 'getOrCreateClientWithRetry')`.
  private async getOrCreateClientWithRetry(info: SkillMcpClientInfo, config: ClaudeCodeMcpServer): Promise<Client> {
    const clientKey = this.getClientKey(info)
    return await getOrCreateClientWithRetryImpl({
      state: this.state,
      clientKey,
      info,
      config,
    })
  }

  getConnectedServers(): string[] {
    return Array.from(this.state.clients.keys())
  }

  isConnected(info: SkillMcpClientInfo): boolean {
    return this.state.clients.has(this.getClientKey(info))
  }
}
