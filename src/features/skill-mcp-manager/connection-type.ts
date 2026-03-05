import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { ConnectionType } from "./types"

/**
 * Determines connection type from MCP server configuration.
 * Priority: explicit type field > url presence > command presence
 */
export function getConnectionType(config: ClaudeCodeMcpServer): ConnectionType | null {
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
