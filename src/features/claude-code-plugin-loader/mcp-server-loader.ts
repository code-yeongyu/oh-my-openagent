import { existsSync } from "fs"
import type { McpServerConfig } from "../claude-code-mcp-loader/types"
import { expandEnvVarsInObject } from "../claude-code-mcp-loader/env-expander"
import { shouldLoadMcpServer } from "../claude-code-mcp-loader/scope-filter"
import { transformMcpServer } from "../claude-code-mcp-loader/transformer"
import type { ClaudeCodeMcpConfig } from "../claude-code-mcp-loader/types"
import { log } from "../../shared/logger"
import type { LoadedPlugin } from "./types"
import { resolvePluginPaths } from "./plugin-path-resolver"

export async function loadPluginMcpServers(
  plugins: LoadedPlugin[],
): Promise<Record<string, McpServerConfig>> {
  const servers: Record<string, McpServerConfig> = {}
  const cwd = process.cwd()

  for (const plugin of plugins) {
    if (!plugin.mcpPath || !existsSync(plugin.mcpPath)) continue

    try {
      const content = await Bun.file(plugin.mcpPath).text()
      let config = JSON.parse(content) as ClaudeCodeMcpConfig

      config = resolvePluginPaths(config, plugin.installPath)
      config = expandEnvVarsInObject(config)

      if (!config.mcpServers) continue

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (!shouldLoadMcpServer(serverConfig, cwd)) {
          log(`Skipping local plugin MCP server "${name}" outside current cwd`, {
            path: plugin.mcpPath,
            projectPath: serverConfig.projectPath,
            cwd,
          })
          continue
        }

        if (serverConfig.disabled) {
          log(`Skipping disabled MCP server "${name}" from plugin ${plugin.name}`)
          continue
        }

        try {
          const transformed = transformMcpServer(name, serverConfig)
          const namespacedName = `${plugin.name}:${name}`
          servers[namespacedName] = transformed
          log(`Loaded plugin MCP server: ${namespacedName}`, { path: plugin.mcpPath })
        } catch (error) {
          log(`Failed to transform plugin MCP server "${name}"`, error)
        }
      }
    } catch (error) {
      log(`Failed to load plugin MCP config: ${plugin.mcpPath}`, error)
    }
  }

  return servers
}
