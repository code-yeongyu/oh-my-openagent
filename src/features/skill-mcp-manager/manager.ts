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

  private getClientKey(info: SkillMcpClientInfo): string {
    return `${info.sessionID}:${info.skillName}:${info.serverName}`
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

    const expandedConfig = expandEnvVarsInObject(config)
    const client = await this.createClient(info, expandedConfig)
    return client
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

    const mergedEnv: Record<string, string> = {}
    if (config.env) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) mergedEnv[key] = value
      }
      Object.assign(mergedEnv, config.env)
    }

    const transport = new StdioClientTransport({
      command,
      args,
      env: config.env ? mergedEnv : undefined,
    })

    const client = new Client(
      { name: `skill-mcp-${info.skillName}-${info.serverName}`, version: "1.0.0" },
      { capabilities: {} }
    )

    try {
      await client.connect(transport)
    } catch (error) {
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
