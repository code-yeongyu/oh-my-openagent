import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import type { McpName } from "./types"
import type { OhMyOpenCodeConfig } from "../config/schema"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createBuiltinMcps(disabledMcps: string[] = [], config?: OhMyOpenCodeConfig) {
  const allBuiltinMcps: Record<McpName, RemoteMcpConfig> = {
    websearch: createWebsearchConfig(config?.websearch),
    context7,
    grep_app,
  }

  const mcps: Record<string, RemoteMcpConfig> = {}

  for (const [name, mcp] of Object.entries(allBuiltinMcps)) {
    if (!disabledMcps.includes(name)) {
      mcps[name] = mcp
    }
  }

  return mcps
}
