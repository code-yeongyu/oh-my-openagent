export interface ToolRegistry {
  isValidTool(name: string): boolean
  getAllToolNames(): string[]
}

interface MCPServerConfig {
  tools?: Array<{ name: string }>
  [key: string]: unknown
}

/**
 * Create tool registry for validation
 * MCP tools use prefix matching: "serverName_methodName"
 */
export function createToolRegistry(
  builtinTools: Record<string, unknown>,
  dynamicTools: Record<string, unknown>,
  mcpServers: Record<string, MCPServerConfig>
): ToolRegistry {
  const toolNames = new Set<string>([
    ...Object.keys(builtinTools),
    ...Object.keys(dynamicTools),
  ])

  const mcpPrefixes = new Set<string>()

  for (const serverName of Object.keys(mcpServers)) {
    mcpPrefixes.add(`${serverName}_`)

    const mcpTools = mcpServers[serverName]?.tools
    if (mcpTools && Array.isArray(mcpTools)) {
      for (const tool of mcpTools) {
        if (tool.name) {
          toolNames.add(tool.name)
        }
      }
    }
  }

  return {
    isValidTool(name: string): boolean {
      if (!name || typeof name !== "string" || name.trim() === "") {
        return false
      }

      if (toolNames.has(name)) {
        return true
      }

      for (const prefix of mcpPrefixes) {
        if (name.startsWith(prefix)) {
          return true
        }
      }

      return false
    },

    getAllToolNames(): string[] {
      return Array.from(toolNames).sort()
    },
  }
}
