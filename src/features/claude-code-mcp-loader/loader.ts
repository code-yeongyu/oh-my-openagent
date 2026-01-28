import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { getClaudeConfigDir } from "../../shared"
import type {
  ClaudeCodeMcpConfig,
  LoadedMcpServer,
  McpLoadResult,
  McpScope,
} from "./types"
import { transformMcpServer } from "./transformer"
import { log } from "../../shared/logger"

interface McpConfigPath {
  path: string
  scope: McpScope
}

function getMcpConfigPaths(): McpConfigPath[] {
  const claudeConfigDir = getClaudeConfigDir()
  const cwd = process.cwd()

  return [
    { path: join(claudeConfigDir, ".mcp.json"), scope: "user" },
    { path: join(cwd, ".mcp.json"), scope: "project" },
    { path: join(cwd, ".claude", ".mcp.json"), scope: "local" },
  ]
}

async function loadMcpConfigFile(
  filePath: string
): Promise<ClaudeCodeMcpConfig | null> {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = await Bun.file(filePath).text()
    return JSON.parse(content) as ClaudeCodeMcpConfig
  } catch (error) {
    log(`Failed to load MCP config from ${filePath}`, error)
    return null
  }
}

export function getSystemMcpServerNames(): Set<string> {
  const names = new Set<string>()
  const paths = getMcpConfigPaths()

  for (const { path } of paths) {
    if (!existsSync(path)) continue

    try {
      const content = readFileSync(path, "utf-8")
      const config = JSON.parse(content) as ClaudeCodeMcpConfig
      if (!config?.mcpServers) continue

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (serverConfig.disabled) continue
        names.add(name)
      }
    } catch {
      continue
    }
  }

  return names
}

export async function loadMcpConfigs(): Promise<McpLoadResult> {
  const servers: McpLoadResult["servers"] = {}
  const loadedServers: LoadedMcpServer[] = []
  const paths = getMcpConfigPaths()

  for (const { path, scope } of paths) {
    const config = await loadMcpConfigFile(path)
    if (!config?.mcpServers) continue

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (serverConfig.disabled) {
        log(`Disabling MCP server "${name}"`, { path })
        delete servers[name]
        const existingIndex = loadedServers.findIndex((s) => s.name === name)
        if (existingIndex !== -1) {
          loadedServers.splice(existingIndex, 1)
          log(`Removed previously loaded MCP server "${name}"`, { path })
        }
        continue
      }

      try {
        const transformed = transformMcpServer(name, serverConfig)
        servers[name] = transformed

        const existingIndex = loadedServers.findIndex((s) => s.name === name)
        if (existingIndex !== -1) {
          loadedServers.splice(existingIndex, 1)
        }

        loadedServers.push({ name, scope, config: transformed })

        log(`Loaded MCP server "${name}" from ${scope}`, { path })
      } catch (error) {
        log(`Failed to transform MCP server "${name}"`, error)
      }
    }
  }

  return { servers, loadedServers }
}

export function formatLoadedServersForToast(
  loadedServers: LoadedMcpServer[]
): string {
  if (loadedServers.length === 0) return ""

  return loadedServers
    .map((server) => `${server.name} (${server.scope})`)
    .join(", ")
}
