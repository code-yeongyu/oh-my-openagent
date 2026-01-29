import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Tool, Resource, Prompt } from "@modelcontextprotocol/sdk/types.js"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import { expandEnvVarsInObject } from "../claude-code-mcp-loader/env-expander"
import { McpOAuthProvider } from "../mcp-oauth/provider"
import { isStepUpRequired, mergeScopes } from "../mcp-oauth/step-up"
import { createCleanMcpEnvironment } from "./env-cleaner"
import type { SkillMcpClientInfo, SkillMcpServerContext } from "./types"

/**
 * Connection type for a managed MCP client.
 * - "stdio": Local process via stdin/stdout
 * - "http": Remote server via HTTP (Streamable HTTP transport)
 */
type ConnectionType = "stdio" | "http"

interface ManagedClientBase {
  client: Client
  skillName: string
  lastUsedAt: number
  connectionType: ConnectionType
}

interface ManagedStdioClient extends ManagedClientBase {
  connectionType: "stdio"
  transport: StdioClientTransport
}

interface ManagedHttpClient extends ManagedClientBase {
  connectionType: "http"
  transport: StreamableHTTPClientTransport
}

type ManagedClient = ManagedStdioClient | ManagedHttpClient

/**
 * Determines connection type from MCP server configuration.
 * Priority: explicit type field > url presence > command presence
 */
function getConnectionType(config: ClaudeCodeMcpServer): ConnectionType | null {
  // Explicit type takes priority
  if (config.type === "http" || config.type === "sse") {
    return "http"
  }
  if (config.type === "stdio") {
    return "stdio"
  }

  // Infer from available fields
  if (config.url) {
    return "http"
  }
  if (config.command) {
    return "stdio"
  }

  return null
}

export class SkillMcpManager {
  private clients: Map<string, ManagedClient> = new Map()
  private pendingConnections: Map<string, Promise<Client>> = new Map()
  private authProviders: Map<string, McpOAuthProvider> = new Map()
  private cleanupRegistered = false
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000

  private getClientKey(info: SkillMcpClientInfo): string {
    return `${info.sessionID}:${info.skillName}:${info.serverName}`
  }

  /**
   * Get or create an McpOAuthProvider for a given server URL + oauth config.
   * Providers are cached by server URL to reuse tokens across reconnections.
   */
  private getOrCreateAuthProvider(
    serverUrl: string,
    oauth: NonNullable<ClaudeCodeMcpServer["oauth"]>
  ): McpOAuthProvider {
    const existing = this.authProviders.get(serverUrl)
    if (existing) {
      return existing
    }

    const provider = new McpOAuthProvider({
      serverUrl,
      clientId: oauth.clientId,
      scopes: oauth.scopes,
    })
    this.authProviders.set(serverUrl, provider)
    return provider
  }

  private registerProcessCleanup(): void {
    if (this.cleanupRegistered) return
    this.cleanupRegistered = true

    const cleanup = async () => {
      for (const [, managed] of this.clients) {
        try {
          await managed.client.close()
        } catch {
          // Ignore errors during cleanup
        }
        try {
          await managed.transport.close()
        } catch {
          // Transport may already be terminated
        }
      }
      this.clients.clear()
      this.pendingConnections.clear()
    }

    // Note: 'exit' event is synchronous-only in Node.js, so we use 'beforeExit' for async cleanup
    // However, 'beforeExit' is not emitted on explicit process.exit() calls
    // Signal handlers are made async to properly await cleanup

    process.on("SIGINT", async () => {
      await cleanup()
      process.exit(0)
    })
    process.on("SIGTERM", async () => {
      await cleanup()
      process.exit(0)
    })
    if (process.platform === "win32") {
      process.on("SIGBREAK", async () => {
        await cleanup()
        process.exit(0)
      })
    }
  }

  async getOrCreateClient(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer
  ): Promise<Client> {
    const key = this.getClientKey(info)
    const existing = this.clients.get(key)

    if (existing) {
      existing.lastUsedAt = Date.now()
      return existing.client
    }

    // Prevent race condition: if a connection is already in progress, wait for it
    const pending = this.pendingConnections.get(key)
    if (pending) {
      return pending
    }

    const expandedConfig = expandEnvVarsInObject(config)
    const connectionPromise = this.createClient(info, expandedConfig)
    this.pendingConnections.set(key, connectionPromise)

    try {
      const client = await connectionPromise
      return client
    } finally {
      this.pendingConnections.delete(key)
    }
  }

  private async createClient(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer
  ): Promise<Client> {
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
        `          Authorization: Bearer \${API_KEY}\n\n` +
        `  Stdio:\n` +
        `    mcp:\n` +
        `      ${info.serverName}:\n` +
        `        command: npx\n` +
        `        args: [-y, @some/mcp-server]`
      )
    }

    if (connectionType === "http") {
      return this.createHttpClient(info, config)
    } else {
      return this.createStdioClient(info, config)
    }
  }

  /**
   * Create an HTTP-based MCP client using StreamableHTTPClientTransport.
   * Supports remote MCP servers with optional authentication headers.
   */
  private async createHttpClient(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer
  ): Promise<Client> {
    const key = this.getClientKey(info)

    if (!config.url) {
      throw new Error(
        `MCP server "${info.serverName}" is configured for HTTP but missing 'url' field.`
      )
    }

    let url: URL
    try {
      url = new URL(config.url)
    } catch {
      throw new Error(
        `MCP server "${info.serverName}" has invalid URL: ${config.url}\n\n` +
        `Expected a valid URL like: https://mcp.example.com/mcp`
      )
    }

    this.registerProcessCleanup()

    // Build request init with headers if provided
    const requestInit: RequestInit = {}
    if (config.headers && Object.keys(config.headers).length > 0) {
      requestInit.headers = { ...config.headers }
    }

    let authProvider: McpOAuthProvider | undefined
    if (config.oauth) {
      authProvider = this.getOrCreateAuthProvider(config.url, config.oauth)
      let tokenData = authProvider.tokens()

      const isExpired = tokenData?.expiresAt != null && tokenData.expiresAt < Math.floor(Date.now() / 1000)
      if (!tokenData || isExpired) {
        try {
          tokenData = await authProvider.login()
        } catch {
          // Login failed — proceed without auth header
        }
      }

      if (tokenData) {
        const existingHeaders = (requestInit.headers ?? {}) as Record<string, string>
        requestInit.headers = {
          ...existingHeaders,
          Authorization: `Bearer ${tokenData.accessToken}`,
        }
      }
    }

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: Object.keys(requestInit).length > 0 ? requestInit : undefined,
    })

    const client = new Client(
      { name: `skill-mcp-${info.skillName}-${info.serverName}`, version: "1.0.0" },
      { capabilities: {} }
    )

    try {
      await client.connect(transport)
    } catch (error) {
      try {
        await transport.close()
      } catch {
        // Transport may already be closed
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to connect to MCP server "${info.serverName}".\n\n` +
        `URL: ${config.url}\n` +
        `Reason: ${errorMessage}\n\n` +
        `Hints:\n` +
        `  - Verify the URL is correct and the server is running\n` +
        `  - Check if authentication headers are required\n` +
        `  - Ensure the server supports MCP over HTTP`
      )
    }

    const managedClient: ManagedHttpClient = {
      client,
      transport,
      skillName: info.skillName,
      lastUsedAt: Date.now(),
      connectionType: "http",
    }
    this.clients.set(key, managedClient)
    this.startCleanupTimer()
    return client
  }

  /**
   * Create a stdio-based MCP client using StdioClientTransport.
   * Spawns a local process and communicates via stdin/stdout.
   */
  private async createStdioClient(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer
  ): Promise<Client> {
    const key = this.getClientKey(info)

    if (!config.command) {
      throw new Error(
        `MCP server "${info.serverName}" is configured for stdio but missing 'command' field.`
      )
    }

    const command = config.command
    const args = config.args || []

    const mergedEnv = createCleanMcpEnvironment(config.env)

    this.registerProcessCleanup()

    const transport = new StdioClientTransport({
      command,
      args,
      env: mergedEnv,
      stderr: "ignore",
    })

    const client = new Client(
      { name: `skill-mcp-${info.skillName}-${info.serverName}`, version: "1.0.0" },
      { capabilities: {} }
    )

    try {
      await client.connect(transport)
    } catch (error) {
      // Close transport to prevent orphaned MCP process on connection failure
      try {
        await transport.close()
      } catch {
        // Process may already be terminated
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to connect to MCP server "${info.serverName}".\n\n` +
        `Command: ${command} ${args.join(" ")}\n` +
        `Reason: ${errorMessage}\n\n` +
        `Hints:\n` +
        `  - Ensure the command is installed and available in PATH\n` +
        `  - Check if the MCP server package exists\n` +
        `  - Verify the args are correct for this server`
      )
    }

    const managedClient: ManagedStdioClient = {
      client,
      transport,
      skillName: info.skillName,
      lastUsedAt: Date.now(),
      connectionType: "stdio",
    }
    this.clients.set(key, managedClient)
    this.startCleanupTimer()
    return client
  }

  async disconnectSession(sessionID: string): Promise<void> {
    const keysToRemove: string[] = []

    for (const [key, managed] of this.clients.entries()) {
      if (key.startsWith(`${sessionID}:`)) {
        keysToRemove.push(key)
        // Delete from map first to prevent re-entrancy during async close
        this.clients.delete(key)
        try {
          await managed.client.close()
        } catch {
          // Ignore close errors - process may already be terminated
        }
        try {
          await managed.transport.close()
        } catch {
          // Transport may already be terminated
        }
      }
    }
  }

  async disconnectAll(): Promise<void> {
    this.stopCleanupTimer()
    const clients = Array.from(this.clients.values())
    this.clients.clear()
    for (const managed of clients) {
      try {
        await managed.client.close()
      } catch { /* process may already be terminated */ }
      try {
        await managed.transport.close()
      } catch { /* transport may already be terminated */ }
    }
  }

  private startCleanupTimer(): void {
    if (this.cleanupInterval) return
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleClients()
    }, 60_000)
    this.cleanupInterval.unref()
  }

  private stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  private async cleanupIdleClients(): Promise<void> {
    const now = Date.now()
    for (const [key, managed] of this.clients) {
      if (now - managed.lastUsedAt > this.IDLE_TIMEOUT) {
        this.clients.delete(key)
        try {
          await managed.client.close()
        } catch { /* process may already be terminated */ }
        try {
          await managed.transport.close()
        } catch { /* transport may already be terminated */ }
      }
    }
  }

  async listTools(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext
  ): Promise<Tool[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.listTools()
    return result.tools
  }

  async listResources(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext
  ): Promise<Resource[]> {
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.listResources()
    return result.resources
  }

  async listPrompts(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext
  ): Promise<Prompt[]> {
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
    return this.withOperationRetry(info, context.config, async (client) => {
      const result = await client.callTool({ name, arguments: args })
      return result.content
    })
  }

  async readResource(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext,
    uri: string
  ): Promise<unknown> {
    return this.withOperationRetry(info, context.config, async (client) => {
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
    return this.withOperationRetry(info, context.config, async (client) => {
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

        const stepUpHandled = await this.handleStepUpIfNeeded(lastError, config)
        if (stepUpHandled) {
          await this.forceReconnect(info)
          continue
        }

        if (!errorMessage.includes("not connected")) {
          throw lastError
        }

        if (attempt === maxRetries) {
          throw new Error(
            `Failed after ${maxRetries} reconnection attempts: ${lastError.message}`
          )
        }

        await this.forceReconnect(info)
      }
    }

    throw lastError || new Error("Operation failed with unknown error")
  }

  private async handleStepUpIfNeeded(
    error: Error,
    config: ClaudeCodeMcpServer
  ): Promise<boolean> {
    if (!config.oauth || !config.url) {
      return false
    }

    const statusMatch = /\b403\b/.exec(error.message)
    if (!statusMatch) {
      return false
    }

    const headers: Record<string, string> = {}
    const wwwAuthMatch = /WWW-Authenticate:\s*(.+)/i.exec(error.message)
    if (wwwAuthMatch?.[1]) {
      headers["www-authenticate"] = wwwAuthMatch[1]
    }

    const stepUp = isStepUpRequired(403, headers)
    if (!stepUp) {
      return false
    }

    const currentScopes = config.oauth.scopes ?? []
    const merged = mergeScopes(currentScopes, stepUp.requiredScopes)
    config.oauth.scopes = merged

    this.authProviders.delete(config.url)
    const provider = this.getOrCreateAuthProvider(config.url, config.oauth)

    try {
      await provider.login()
      return true
    } catch {
      return false
    }
  }

  private async forceReconnect(info: SkillMcpClientInfo): Promise<void> {
    const key = this.getClientKey(info)
    const existing = this.clients.get(key)
    if (existing) {
      this.clients.delete(key)
      try {
        await existing.client.close()
      } catch { /* process may already be terminated */ }
      try {
        await existing.transport.close()
      } catch { /* transport may already be terminated */ }
    }
  }

  private async getOrCreateClientWithRetry(
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer
  ): Promise<Client> {
    try {
      return await this.getOrCreateClient(info, config)
    } catch (error) {
      const key = this.getClientKey(info)
      const existing = this.clients.get(key)
      if (existing) {
        this.clients.delete(key)
        try {
          await existing.client.close()
        } catch { /* process may already be terminated */ }
        try {
          await existing.transport.close()
        } catch { /* transport may already be terminated */ }
        return await this.getOrCreateClient(info, config)
      }
      throw error
    }
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.keys())
  }

  isConnected(info: SkillMcpClientInfo): boolean {
    return this.clients.has(this.getClientKey(info))
  }
}
