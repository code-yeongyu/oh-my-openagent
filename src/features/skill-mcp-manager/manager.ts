import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { Tool, Resource, Prompt } from "@modelcontextprotocol/sdk/types.js"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import { expandEnvVarsInObject } from "../claude-code-mcp-loader/env-expander"
import type { SkillMcpClientInfo, SkillMcpServerContext } from "./types"

interface ManagedClient {
  client: Client
  transport: StdioClientTransport
  skillName: string
}

export class SkillMcpManager {
  private clients: Map<string, ManagedClient> = new Map()
  private pendingConnections: Map<string, Promise<Client>> = new Map()
  private cleanupRegistered = false

  private getClientKey(info: SkillMcpClientInfo): string {
    return `${info.sessionID}:${info.skillName}:${info.serverName}`
  }

  private registerProcessCleanup(): void {
    if (this.cleanupRegistered) return
    this.cleanupRegistered = true

    const cleanup = () => {
      for (const [, managed] of this.clients) {
        try {
          managed.client.close()
        } catch {
          // Ignore errors during cleanup
        }
      }
      this.clients.clear()
      this.pendingConnections.clear()
    }

    process.on("exit", cleanup)
    process.on("SIGINT", () => {
      cleanup()
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      cleanup()
      process.exit(0)
    })
    if (process.platform === "win32") {
      process.on("SIGBREAK", () => {
        cleanup()
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
    const key = this.getClientKey(info)

    if (!config.command) {
      throw new Error(
        `MCP server "${info.serverName}" is missing required 'command' field.\n\n` +
        `The MCP configuration in skill "${info.skillName}" must specify a command to execute.\n\n` +
        `Example:\n` +
        `  mcp:\n` +
        `    ${info.serverName}:\n` +
        `      command: npx\n` +
        `      args: [-y, @some/mcp-server]`
      )
    }

    const command = config.command
    const args = config.args || []

    // Always inherit parent process environment
    const mergedEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) mergedEnv[key] = value
    }
    // Overlay with skill-specific env vars if present
    if (config.env) {
      Object.assign(mergedEnv, config.env)
    }

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

    this.clients.set(key, { client, transport, skillName: info.skillName })
    return client
  }

  async disconnectSession(sessionID: string): Promise<void> {
    const keysToRemove: string[] = []

    for (const [key, managed] of this.clients.entries()) {
      if (key.startsWith(`${sessionID}:`)) {
        keysToRemove.push(key)
        try {
          await managed.client.close()
        } catch {
          // Ignore close errors - process may already be terminated
        }
      }
    }

    for (const key of keysToRemove) {
      this.clients.delete(key)
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [, managed] of this.clients.entries()) {
      try {
        await managed.client.close()
      } catch { /* process may already be terminated */ }
    }
    this.clients.clear()
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
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.callTool({ name, arguments: args })
    return result.content
  }

  async readResource(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext,
    uri: string
  ): Promise<unknown> {
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.readResource({ uri })
    return result.contents
  }

  async getPrompt(
    info: SkillMcpClientInfo,
    context: SkillMcpServerContext,
    name: string,
    args: Record<string, string>
  ): Promise<unknown> {
    const client = await this.getOrCreateClientWithRetry(info, context.config)
    const result = await client.getPrompt({ name, arguments: args })
    return result.messages
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
        try {
          await existing.client.close()
        } catch { /* process may already be terminated */ }
        this.clients.delete(key)
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
