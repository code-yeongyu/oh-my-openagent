import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import { document_reader } from "./document-reader"
import { semantic_scholar } from "./semantic-scholar"
import type { MatrixxConfig } from "../config/schema"

export { McpNameSchema, type McpName } from "./types"

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

  if (!disabledMcps.includes("semantic_scholar")) {
    mcps.semantic_scholar = semantic_scholar
  }

  return mcps
}
