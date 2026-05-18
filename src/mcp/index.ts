import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import { createAstGrepMcpConfig } from "./ast-grep"
import { createLspMcpConfig, type LocalMcpConfig } from "./lsp"
import type { OhMyOpenCodeConfig } from "../config/schema"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

type BuiltinMcpConfig = RemoteMcpConfig | LocalMcpConfig

type BuiltinMcpOptions = {
  readonly cwd?: string
}

export function createBuiltinMcps(disabledMcps: string[] = [], config?: OhMyOpenCodeConfig, options: BuiltinMcpOptions = {}) {
  const mcps: Record<string, BuiltinMcpConfig> = {}

  if (!disabledMcps.includes("websearch")) {
    const websearchConfig = createWebsearchConfig(config?.websearch)
    if (websearchConfig) {
      mcps.websearch = websearchConfig
    }
  }

  if (!disabledMcps.includes("context7")) {
    mcps.context7 = context7
  }

  if (!disabledMcps.includes("grep_app")) {
    mcps.grep_app = grep_app
  }

  if (!disabledMcps.includes("lsp")) {
    mcps.lsp = createLspMcpConfig()
  }

  if (!disabledMcps.includes("ast_grep")) {
    mcps.ast_grep = createAstGrepMcpConfig({ cwd: options.cwd, disabledTools: config?.disabled_tools })
  }

  return mcps
}
