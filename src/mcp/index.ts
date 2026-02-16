import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import type { McpName } from "./types"
import type { OhMyOpenCodeConfig } from "../config/schema"
import { log } from "../shared/logger"
import { resolveMcpTemplates } from "./templates"
import { createLazyMcpRegistry } from "./lazy-loader"
import { createMcpHealthChecker } from "./health-checker"
import { createPostHookTrigger } from "./post-hook-trigger"

export { McpNameSchema, type McpName } from "./types"
export { resolveMcpTemplates } from "./templates"
export { createLazyMcpRegistry } from "./lazy-loader"
export { createMcpHealthChecker } from "./health-checker"
export { createPostHookTrigger } from "./post-hook-trigger"

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

  // Add template-based MCPs if configured
  if (config?.mcp?.templates) {
    const templateMcps = resolveMcpTemplates(config.mcp.templates)
    for (const [name, mcpConfig] of Object.entries(templateMcps)) {
      if (!disabledMcps.includes(name)) {
        mcps[name] = mcpConfig
      }
    }
  }

  return mcps
}

/**
 * Registry for lazy-loaded MCPs
 */
export const lazyMcpRegistry = createLazyMcpRegistry()

/**
 * Health checker for remote MCPs
 */
export const mcpHealthChecker = createMcpHealthChecker()

/**
 * Global instance of MCP post-hook trigger
 */
export const mcpPostHookTrigger = createPostHookTrigger({
  enabled: true,
  timeoutMs: 10000,
})
