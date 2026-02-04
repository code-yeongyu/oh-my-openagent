import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import type { McpName } from "./types"
import type { OhMyOpenCodeConfig } from "../config/schema"
import { log } from "../shared/logger"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

const DEFAULT_TOOL_COUNT_WARNING_THRESHOLD = 80

export interface McpToolCountWarningOptions {
  threshold?: number
}

/**
 * Check if the number of MCP tools exceeds the warning threshold.
 * Logs a warning but does not block startup.
 */
export function checkMcpToolCount(
  toolCount: number,
  options: McpToolCountWarningOptions = {}
): { warned: boolean; message?: string } {
  const threshold = options.threshold ?? DEFAULT_TOOL_COUNT_WARNING_THRESHOLD

  if (toolCount > threshold) {
    const message = `[MCP Warning] Tool count (${toolCount}) exceeds threshold (${threshold}). ` +
      `Consider disabling unused MCPs to improve performance and reduce confusion.`
    log(message)
    return { warned: true, message }
  }

  return { warned: false }
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
