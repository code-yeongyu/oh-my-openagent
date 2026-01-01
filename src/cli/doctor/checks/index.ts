import type { CheckDefinition } from "../types"
import { getOpenCodeCheckDefinition } from "./opencode"
import { getPluginCheckDefinition } from "./plugin"
import { getConfigCheckDefinition } from "./config"
import { getAuthCheckDefinitions } from "./auth"
import { getDependencyCheckDefinitions } from "./dependencies"
import { getGhCliCheckDefinition } from "./gh"
import { getLspCheckDefinition } from "./lsp"
import { getMcpCheckDefinitions } from "./mcp"
import { getVersionCheckDefinition } from "./version"

export * from "./opencode"
export * from "./plugin"
export * from "./config"
export * from "./auth"
export * from "./dependencies"
export * from "./gh"
export * from "./lsp"
export * from "./mcp"
export * from "./version"

export function getAllCheckDefinitions(): CheckDefinition[] {
  return [
    getOpenCodeCheckDefinition(),
    getPluginCheckDefinition(),
    getConfigCheckDefinition(),
    ...getAuthCheckDefinitions(),
    ...getDependencyCheckDefinitions(),
    getGhCliCheckDefinition(),
    getLspCheckDefinition(),
    ...getMcpCheckDefinitions(),
    getVersionCheckDefinition(),
  ]
}
