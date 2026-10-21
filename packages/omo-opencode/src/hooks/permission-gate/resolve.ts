import type { OmoToolPermissionValue } from "@oh-my-opencode/omo-config-core"

import type { PermissionGateDecision } from "./schema"
import type { SessionPermissionCache } from "./session-cache"

/**
 * Tools that only read. These default to `allow` so the common case of an
 * agent exploring a repo costs no decision. Every other tool defaults to
 * `ask`: an unlisted tool has not been classified yet, and the safe answer
 * for an unclassified tool is to make the user say yes once.
 */
const READ_ONLY_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "session_list",
  "session_read",
  "session_search",
  "session_info",
])

function normalize(tool: string): string {
  return tool.toLowerCase().replace(/^mcp_/, "")
}

function lookupAgentOverride(
  agentOverrides: unknown,
  agentName: string,
  tool: string,
): OmoToolPermissionValue | undefined {
  if (!agentOverrides || typeof agentOverrides !== "object") return undefined
  const root = agentOverrides as Record<string, unknown>
  const entry = root[agentName]
  if (!entry || typeof entry !== "object") return undefined
  const toolsMap = (entry as { tools?: unknown }).tools
  if (!toolsMap || typeof toolsMap !== "object") return undefined
  const toolEntry = (toolsMap as Record<string, unknown>)[tool]
  if (!toolEntry || typeof toolEntry !== "object") return undefined
  const permission = (toolEntry as { permission?: unknown }).permission
  if (
    permission === "allow" || permission === "ask" || permission === "deny"
  ) {
    return permission
  }
  return undefined
}

export type ResolveArgs = {
  pluginConfig: PluginConfigLike
  tool: string
  targetPath?: string | undefined
  sessionID: string
  cache: SessionPermissionCache
  agentName?: string
  agentOverrides?: unknown
}

type PluginConfigLike = {
  tools?: Record<string, { permission?: OmoToolPermissionValue }>
}

/**
 * Resolution order (highest priority wins):
 *   1. session-cached `ask` decision. If the gate has already prompted for
 *      this (session, tool, target-path) in this session and the user
 *      accepted, the next call resolves to `allow` without a re-prompt.
 *      A `deny` override is NOT cached the same way; an explicit deny stays
 *      deny until the user lifts it.
 *   2. explicit user override (session-scoped cache, set by the user mid-session)
 *   3. per-tool `tools.<name>.permission` in pluginConfig (top-level + [opencode] block)
 *   4. per-agent profile override (`agents.<name>.tools.<tool>.permission`)
 *   5. built-in default for the tool category (allow for read-only, ask for mutating)
 */
export function resolveToolPermission(args: ResolveArgs): PermissionGateDecision {
  const tool = normalize(args.tool)
  const targetPath = args.targetPath
  const key = { sessionID: args.sessionID, tool, targetPath }

  if (args.cache.hasAskDecision(key)) {
    return {
      value: "allow",
      source: "session_cache",
      tool,
      targetPath,
      sessionID: args.sessionID,
    }
  }

  const userOverride = args.cache.getUserOverride(key)
  if (userOverride) {
    return {
      value: userOverride,
      source: "user_override",
      tool,
      targetPath,
      sessionID: args.sessionID,
    }
  }

  const topLevel = args.pluginConfig?.tools?.[tool]?.permission
  if (topLevel) {
    return {
      value: topLevel,
      source: "tools_override",
      tool,
      targetPath,
      sessionID: args.sessionID,
    }
  }

  if (args.agentName) {
    const agentOverride = lookupAgentOverride(args.agentOverrides, args.agentName, tool)
    if (agentOverride) {
      return {
        value: agentOverride,
        source: "agent_override",
        tool,
        targetPath,
        sessionID: args.sessionID,
      }
    }
  }

  if (READ_ONLY_TOOLS.has(tool)) {
    return {
      value: "allow",
      source: "default",
      tool,
      targetPath,
      sessionID: args.sessionID,
    }
  }

  // Every other tool, including one this version has never heard of, defaults
  // to `ask`. `deny` is never an unprompted default.
  return { value: "ask", source: "default", tool, targetPath, sessionID: args.sessionID }
}
