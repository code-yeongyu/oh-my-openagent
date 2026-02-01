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
  const mcps: Record<string, RemoteMcpConfig> = {}

  if (!disabledMcps.includes("websearch")) {
    mcps.websearch = createWebsearchConfig(config?.websearch)
  }

  if (!disabledMcps.includes("context7")) {
    mcps.context7 = context7
  }

  if (!disabledMcps.includes("grep_app")) {
    mcps.grep_app = grep_app
  }

  return mcps
}
