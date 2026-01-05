import { websearch_exa } from "./websearch-exa"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import type { McpName } from "./types"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
}

const allBuiltinMcps: Record<McpName, RemoteMcpConfig> = {
  websearch_exa,
  context7,
  grep_app,
}

export function createBuiltinMcps(disabledMcps: McpName[] = []) {
  const mcps: Record<string, RemoteMcpConfig> = {}

  for (const [name, config] of Object.entries(allBuiltinMcps)) {
    if (!disabledMcps.includes(name as McpName)) {
      mcps[name] = config
    }
  }

  return mcps
}
