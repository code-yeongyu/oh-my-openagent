import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { McpServerInfo } from "../types"
import { parseJsonc } from "../../../shared"

const BUILTIN_MCP_SERVERS = ["context7", "grep_app"]

interface McpConfigShape {
  mcpServers?: Record<string, unknown>
}

function getMcpConfigPaths(): string[] {
  return [
    join(homedir(), ".claude", ".mcp.json"),
    join(process.cwd(), ".mcp.json"),
    join(process.cwd(), ".claude", ".mcp.json"),
  ]
}

function loadUserMcpConfig(): Record<string, unknown> {
  const servers: Record<string, unknown> = {}

  for (const configPath of getMcpConfigPaths()) {
    if (!existsSync(configPath)) continue

    try {
      const content = readFileSync(configPath, "utf-8")
      const config = parseJsonc<McpConfigShape>(content)
      if (config.mcpServers) {
        Object.assign(servers, config.mcpServers)
      }
    } catch {
      continue
    }
  }

  return servers
}

export function getBuiltinMcpInfo(): McpServerInfo[] {
  return BUILTIN_MCP_SERVERS.map((serverId) => ({
    id: serverId,
    type: "builtin",
    enabled: true,
    valid: true,
  }))
}

export function getUserMcpInfo(): McpServerInfo[] {
  return Object.entries(loadUserMcpConfig()).map(([serverId, value]) => {
    const valid = typeof value === "object" && value !== null
    return {
      id: serverId,
      type: "user",
      enabled: true,
      valid,
      error: valid ? undefined : "Invalid configuration format",
    }
  })
}
