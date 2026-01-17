import { websearch } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import type { McpName } from "./types"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

const allBuiltinMcps: Record<McpName, RemoteMcpConfig> = {
  websearch,
  context7,
  grep_app,
}

export function createBuiltinMcps(disabledMcps: string[] = []) {
  const mcps: Record<string, RemoteMcpConfig> = {}

  for (const [name, config] of Object.entries(allBuiltinMcps)) {
    if (!disabledMcps.includes(name)) {
      mcps[name] = config
    }
  }

  return mcps
}
