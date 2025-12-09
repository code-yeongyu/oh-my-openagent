import type {
  ClaudeCodeMcpServer,
  McpLocalConfig,
  McpRemoteConfig,
  McpServerConfig,
} from "./types"
import { expandEnvVarsInObject } from "./env-expander"

export function transformMcpServer(
  name: string,
  server: ClaudeCodeMcpServer
): McpServerConfig {
  const expanded = expandEnvVarsInObject(server)
  const serverType = expanded.type ?? "stdio"

  if (serverType === "http" || serverType === "sse") {
    if (!expanded.url) {
      throw new Error(
        `MCP server "${name}" requires url for type "${serverType}"`
      )
    }

    const config: McpRemoteConfig = {
      type: "remote",
      url: expanded.url,
      enabled: true,
    }

    if (expanded.headers && Object.keys(expanded.headers).length > 0) {
      config.headers = expanded.headers
    }

    return config
  }

  if (!expanded.command) {
    throw new Error(`MCP server "${name}" requires command for stdio type`)
  }

  const commandArray = [expanded.command, ...(expanded.args ?? [])]

  const config: McpLocalConfig = {
    type: "local",
    command: commandArray,
    enabled: true,
  }

  if (expanded.env && Object.keys(expanded.env).length > 0) {
    config.environment = expanded.env
  }

  return config
}
