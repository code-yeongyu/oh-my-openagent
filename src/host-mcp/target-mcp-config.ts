import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  setAdditionalAllowedMcpEnvVars,
  transformMcpServer,
  type ClaudeCodeMcpConfig,
  type McpServerConfig,
} from "../features/claude-code-mcp-loader"
import { createBuiltinMcps } from "../mcp"

export type TargetMcpConfig = McpServerConfig | ReturnType<typeof createBuiltinMcps>[string]

export type TargetMcpInventory = {
  servers: Record<string, TargetMcpConfig>
  sources: Record<string, "builtin" | "user" | "project" | "local">
}

type TargetMcpInventoryOptions = {
  cwd: string
  disabledMcps?: readonly string[]
  envAllowlist?: readonly string[]
  home?: string
}

function readClaudeMcpConfig(path: string): ClaudeCodeMcpConfig | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof value !== "object" || value === null) return undefined
    return value as ClaudeCodeMcpConfig
  } catch {
    return undefined
  }
}

export function loadTargetMcpInventory(options: TargetMcpInventoryOptions): TargetMcpInventory {
  const disabled = new Set(options.disabledMcps ?? [])
  const servers: Record<string, TargetMcpConfig> = {
    ...createBuiltinMcps([...disabled], undefined, { cwd: options.cwd }),
  }
  const sources: TargetMcpInventory["sources"] = {}
  for (const name of Object.keys(servers)) sources[name] = "builtin"

  setAdditionalAllowedMcpEnvVars([...(options.envAllowlist ?? [])])
  const home = options.home ?? homedir()
  const paths: Array<{ path: string; source: "user" | "project" | "local" }> = [
    { path: join(home, ".claude", ".mcp.json"), source: "user" },
    { path: join(options.cwd, ".mcp.json"), source: "project" },
    { path: join(options.cwd, ".claude", ".mcp.json"), source: "local" },
  ]

  for (const entry of paths) {
    const config = readClaudeMcpConfig(entry.path)
    for (const [name, server] of Object.entries(config?.mcpServers ?? {})) {
      if (disabled.has(name) || server.disabled) {
        delete servers[name]
        delete sources[name]
        continue
      }
      try {
        servers[name] = transformMcpServer(name, server)
        sources[name] = entry.source
      } catch {
        continue
      }
    }
  }

  return { servers, sources }
}
