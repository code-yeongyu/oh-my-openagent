import { websearch } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import type { McpName } from "./types"
import { log } from "../shared/logger"

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

export function createBuiltinMcps(disabledMcps: string[] = []) {
  const mcps: Record<string, RemoteMcpConfig> = {}

  for (const [name, config] of Object.entries(allBuiltinMcps)) {
    if (!disabledMcps.includes(name)) {
      mcps[name] = config
    }
  }

  return mcps
}
