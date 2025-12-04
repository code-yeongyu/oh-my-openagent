import type { McpName } from "../config"
import { websearch_exa } from "./websearch-exa"
import { context7 } from "./context7"

export type { McpName }

const allBuiltinMcps: Record<McpName, { type: "remote"; url: string; enabled: boolean }> = {
  websearch_exa,
  context7,
}

export function createBuiltinMcps(disabledMcps: McpName[] = []) {
  const mcps: Record<string, { type: "remote"; url: string; enabled: boolean }> = {}

  for (const [name, config] of Object.entries(allBuiltinMcps)) {
    if (!disabledMcps.includes(name as McpName)) {
      mcps[name] = config
    }
  }

  return mcps
}

export const builtinMcps = allBuiltinMcps
