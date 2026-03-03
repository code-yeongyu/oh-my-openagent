import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { McpOAuthProvider } from "../mcp-oauth/provider"

export type SkillMcpConfig = Record<string, ClaudeCodeMcpServer>

export interface SkillMcpClientInfo {
  serverName: string
  skillName: string
  sessionID: string
}

export interface SkillMcpServerContext {
  config: ClaudeCodeMcpServer
  skillName: string
}

/**
 * Connection type for a managed MCP client.
 * - "stdio": Local process via stdin/stdout
 * - "http": Remote server via HTTP (Streamable HTTP transport)
 */
export type ConnectionType = "stdio" | "http"

export interface ManagedClientBase {
  client: Client
  skillName: string
  lastUsedAt: number
  connectionType: ConnectionType
}

export interface ManagedStdioClient extends ManagedClientBase {
  connectionType: "stdio"
  transport: StdioClientTransport
}

export interface ManagedHttpClient extends ManagedClientBase {
  connectionType: "http"
  transport: StreamableHTTPClientTransport
}

export type ManagedClient = ManagedStdioClient | ManagedHttpClient

export interface ProcessCleanupHandler {
  signal: NodeJS.Signals
  listener: () => void
}

export interface SkillMcpManagerState {
  clients: Map<string, ManagedClient>
  pendingConnections: Map<string, Promise<Client>>
  authProviders: Map<string, McpOAuthProvider>
  cleanupRegistered: boolean
  cleanupInterval: ReturnType<typeof setInterval> | null
  cleanupHandlers: ProcessCleanupHandler[]
  idleTimeoutMs: number
}

export interface SkillMcpClientConnectionParams {
  state: SkillMcpManagerState
  clientKey: string
  info: SkillMcpClientInfo
  config: ClaudeCodeMcpServer
}
