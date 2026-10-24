import type { Prompt, Resource, Tool } from "@modelcontextprotocol/sdk/types.js"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { McpOAuthProvider } from "../mcp-oauth/provider"
import { disconnectAll, disconnectSession, forceReconnect } from "./cleanup"
import { getOrCreateClient, getOrCreateClientWithRetryImpl } from "./connection"
import { handlePostRequestAuthError, handleStepUpIfNeeded } from "./oauth-handler"
import { EnvironmentGrantPolicy } from "./environment-grant-policy"
import { createFileGrantStore, type GrantStore } from "./env-grant-store"
import { policyHash } from "./project-env-policy"
import type {
  McpClient,
  OAuthProviderFactory,
  SkillMcpClientInfo,
  SkillMcpManagerState,
  SkillMcpServerContext,
} from "./types"

export interface SkillMcpClientOptions {
  cdpUrl?: string
  env?: Readonly<Record<string, string>>
}

export function buildSkillMcpClientKey(info: SkillMcpClientInfo, options?: SkillMcpClientOptions): string {
  const baseKey = `${info.sessionID}:${info.skillName}:${info.serverName}`
  const authorityKey = info.provenance ? `${baseKey}::provenance=${policyHash(info.provenance)}` : baseKey
  if (!options?.cdpUrl) {
    return authorityKey
  }

  return `${authorityKey}::cdp=${options.cdpUrl}`
}

export class SkillMcpManager {
  private readonly state: SkillMcpManagerState

  constructor(options: {
    createOAuthProvider?: OAuthProviderFactory
    grantStore?: GrantStore
    configDir?: string
    onEnvironmentNotice?: (message: string, info: SkillMcpClientInfo) => void
  } = {}) {
    this.state = {
      clients: new Map(),
      pendingConnections: new Map(),
      disconnectedSessions: new Map(),
      authProviders: new Map(),
      cleanupRegistered: false,
      cleanupInterval: null,
      cleanupHandlers: [],
      idleTimeoutMs: 5 * 60 * 1000,
      shutdownGeneration: 0,
      inFlightConnections: new Map(),
      disposed: false,
      createOAuthProvider: options.createOAuthProvider ?? ((providerOptions) => new McpOAuthProvider(providerOptions)),
    }
    this.state.environmentPolicy = new EnvironmentGrantPolicy(options.grantStore ?? createFileGrantStore(options.configDir), options.onEnvironmentNotice, (identity) => this.closeIdentityClients(identity))
  }

  async invalidateIdentity(identity: string): Promise<void> {
    this.state.environmentPolicy?.invalidateIdentity(identity)
    await this.closeIdentityClients(identity)
  }

  private async closeIdentityClients(identity: string): Promise<void> {
    for (const key of this.state.pendingConnections.keys()) {
      if (key.includes(`::identity=${identity}::`)) this.state.pendingConnections.delete(key)
    }
    for (const key of this.state.clients.keys()) {
      if (key.includes(`::identity=${identity}::`)) await forceReconnect(this.state, key)
    }
  }

  async grantEnvironment(id: string, names?: readonly string[]): Promise<string> {
    if (!this.state.environmentPolicy) throw new Error("MCP environment grant policy is unavailable.")
    return this.state.environmentPolicy.grant(id, names)
  }

  getEnvironmentNotice(info: SkillMcpClientInfo): string | undefined {
    return this.state.environmentPolicy?.notice(info)
  }

  private getClientKey(info: SkillMcpClientInfo, options?: SkillMcpClientOptions): string {
    return buildSkillMcpClientKey(info, options)
  }

  async getOrCreateClient(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer,
    options?: SkillMcpClientOptions
  ): Promise<McpClient> {
    const clientKey = this.getClientKey(info, options)
    return await getOrCreateClient({
      state: this.state,
      clientKey,
      info,
      config,
      sessionEnv: options?.env,
      cdpUrl: options?.cdpUrl,
    })
  }

  async disconnectSession(sessionID: string): Promise<void> {
    await disconnectSession(this.state, sessionID)
  }

  async disconnectAll(): Promise<void> {
    await disconnectAll(this.state)
  }

  async listTools(info: SkillMcpClientInfo, context: SkillMcpServerContext, options?: SkillMcpClientOptions): Promise<Tool[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config, options)
    return this.collectPages(async (cursor) => {
      const result = await client.listTools(cursor === undefined ? undefined : { cursor })
      return { items: result.tools, nextCursor: result.nextCursor }
    })
  }

  async listResources(info: SkillMcpClientInfo, context: SkillMcpServerContext, options?: SkillMcpClientOptions): Promise<Resource[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config, options)
    return this.collectPages(async (cursor) => {
      const result = await client.listResources(cursor === undefined ? undefined : { cursor })
      return { items: result.resources, nextCursor: result.nextCursor }
    })
  }

  async listPrompts(info: SkillMcpClientInfo, context: SkillMcpServerContext, options?: SkillMcpClientOptions): Promise<Prompt[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config, options)
    return this.collectPages(async (cursor) => {
      const result = await client.listPrompts(cursor === undefined ? undefined : { cursor })
      return { items: result.prompts, nextCursor: result.nextCursor }
    })
  }

  private async collectPages<T>(
    request: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
  ): Promise<T[]> {
    const items: T[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const result = await request(cursor)
      items.push(...result.items)
      if (result.nextCursor === undefined) return items
      cursor = result.nextCursor
    }
    throw new Error("MCP list pagination exceeded 100 pages.")
  }

  async callTool(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext,
    name: string,
    args: Record<string, unknown>,
    options?: SkillMcpClientOptions
  ): Promise<unknown> {
    return await this.withOperationRetry(info, context.config, options, async (client) => {
      const result = await client.callTool({ name, arguments: args })
      return result.content
    })
  }

  async readResource(info: SkillMcpClientInfo, context: SkillMcpServerContext, uri: string, options?: SkillMcpClientOptions): Promise<unknown> {
    return await this.withOperationRetry(info, context.config, options, async (client) => {
      const result = await client.readResource({ uri })
      return result.contents
    })
  }

  async getPrompt(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext,
    name: string,
    args: Record<string, string>,
    options?: SkillMcpClientOptions
  ): Promise<unknown> {
    return await this.withOperationRetry(info, context.config, options, async (client) => {
      const result = await client.getPrompt({ name, arguments: args })
      return result.messages
    })
  }

  private async withOperationRetry<T>(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer,
    options: SkillMcpClientOptions | undefined,
    operation: (client: McpClient) => Promise<T>
  ): Promise<T> {
    const maxRetries = 3
    let lastError: Error | null = null
    const refreshAttempted = new Set<string>()

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.getOrCreateClientWithRetry(info, config, options)
        return await operation(client)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const errorMessage = lastError.message.toLowerCase()

        const stepUpHandled = await handleStepUpIfNeeded({
          error: lastError,
          config,
          authProviders: this.state.authProviders,
          createOAuthProvider: this.state.createOAuthProvider,
        })
        if (stepUpHandled) {
          await forceReconnect(this.state, this.getClientKey(info, options))
          continue
        }

        const postRequestRefreshHandled = await handlePostRequestAuthError({
          error: lastError,
          config,
          authProviders: this.state.authProviders,
          createOAuthProvider: this.state.createOAuthProvider,
          refreshAttempted,
        })
        if (postRequestRefreshHandled) {
          continue
        }

        if (!errorMessage.includes("not connected")) {
          throw lastError
        }

        if (attempt === maxRetries) {
          throw new Error(`Failed after ${maxRetries} reconnection attempts: ${lastError.message}`)
        }

        await forceReconnect(this.state, this.getClientKey(info, options))
      }
    }

    throw lastError ?? new Error("Operation failed with unknown error")
  }

  private async getOrCreateClientWithRetry(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer,
    options?: SkillMcpClientOptions
  ): Promise<McpClient> {
    const clientKey = this.getClientKey(info, options)
    return await getOrCreateClientWithRetryImpl({
      state: this.state,
      clientKey,
      info,
      config,
      sessionEnv: options?.env,
      cdpUrl: options?.cdpUrl,
    })
  }

  getConnectedServers(): string[] {
    return Array.from(this.state.clients.keys())
  }

  isConnected(info: SkillMcpClientInfo): boolean {
    const base = this.getClientKey(info)
    return [...this.state.clients.keys()].some((key) => key === base || key.startsWith(`${base}::identity=`))
  }
}
