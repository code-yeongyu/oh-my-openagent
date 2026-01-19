import { websearch } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import { 
  context_engine_indexer_mcp, 
  context_engine_memory_mcp, 
  MCP_NAME_INDEXER, 
  MCP_NAME_MEMORY 
} from "./context-engine-mcp"
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
  [MCP_NAME_INDEXER]: context_engine_indexer_mcp,
  [MCP_NAME_MEMORY]: context_engine_memory_mcp,
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
