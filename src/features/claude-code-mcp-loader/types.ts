export type McpScope = "user" | "project" | "local"

export interface ClaudeCodeMcpServer {
  type?: "http" | "sse" | "stdio"
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  disabled?: boolean
  /** Timeout in ms for MCP server requests */
  timeout?: number
}

export interface ClaudeCodeMcpConfig {
  mcpServers?: Record<string, ClaudeCodeMcpServer>
}

export interface McpLocalConfig {
  type: "local"
  command: string[]
  environment?: Record<string, string>
  enabled?: boolean
  /** Timeout in ms for MCP server requests */
  timeout?: number
}

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
}

export interface McpRemoteConfig {
  type: "remote"
  url: string
  headers?: Record<string, string>
  enabled?: boolean
  /** OAuth config, or false to disable OAuth auto-detection */
  oauth?: McpOAuthConfig | false
  /** Timeout in ms for MCP server requests */
  timeout?: number
}

export type McpServerConfig = McpLocalConfig | McpRemoteConfig

export interface LoadedMcpServer {
  name: string
  scope: McpScope
  config: McpServerConfig
}

export interface McpLoadResult {
  servers: Record<string, McpServerConfig>
  loadedServers: LoadedMcpServer[]
}
