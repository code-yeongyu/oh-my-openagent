import type { MatrixxConfig } from "../config/schema"
import { context7 } from "./context7"
import { document_reader } from "./document-reader"
import { grep_app } from "./grep-app"
import { createWebsearchConfig } from "./websearch"

export { type McpName, McpNameSchema } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

type LocalMcpConfig = {
  type: "local"
  command: string[]
  enabled: boolean
}

type BuiltinMcpConfig = RemoteMcpConfig | LocalMcpConfig

export function createBuiltinMcps(disabledMcps: string[] = [], config?: MatrixxConfig) {
  const mcps: Record<string, BuiltinMcpConfig> = {}

  if (!disabledMcps.includes("websearch")) {
    mcps.websearch = createWebsearchConfig(config?.websearch)
  }

  if (!disabledMcps.includes("context7")) {
    mcps.context7 = context7
  }

  if (!disabledMcps.includes("grep_app")) {
    mcps.grep_app = grep_app
  }

  if (!disabledMcps.includes("document_reader")) {
    mcps.document_reader = document_reader
  }

  return mcps
}
