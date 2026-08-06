import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import { createCodegraphMcpConfig, type CodegraphMcpConfigOptions } from "./codegraph"
import { createLspMcpConfig, type LocalMcpConfig } from "./lsp"
import type { RuntimeExecutableResolver } from "./runtime-executable"
import type { CodegraphConfig } from "../config/schema/codegraph"

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
  readonly codegraph?: Pick<
    CodegraphMcpConfigOptions,
    "env" | "fileExists" | "homeDir" | "provisioned" | "requireResolve"
  >
  readonly cwd?: string
  readonly resolveExecutable?: RuntimeExecutableResolver
}

type BuiltinMcpSourceConfig = {
  readonly codegraph?: Partial<CodegraphConfig>
  readonly disabled_tools?: readonly string[]
  readonly websearch?: Parameters<typeof createWebsearchConfig>[0]
}

export function createBuiltinMcps(disabledMcps: string[] = [], config?: BuiltinMcpSourceConfig, options: BuiltinMcpOptions = {}) {
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
    mcps.lsp = createLspMcpConfig({
      cwd: options.cwd,
      resolveExecutable: options.resolveExecutable,
    })
  }

  if (!disabledMcps.includes("codegraph") && config?.codegraph?.enabled !== false) {
    mcps.codegraph = createCodegraphMcpConfig({
      config: config?.codegraph,
      cwd: options.cwd,
      ...options.codegraph,
      resolveExecutable: options.resolveExecutable,
    })
  }

  return mcps
}
