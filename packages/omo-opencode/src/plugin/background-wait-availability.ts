import type { OhMyOpenCodeConfig } from "../config"
import { getSessionAgent } from "../features/claude-code-session-state"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { getSessionTools } from "../shared/session-tools-store"
import { matchesToolMatcher } from "../shared/pattern-matcher"

const BACKGROUND_WAIT_TOOL = "wait-for-background-tasks"

export function createBackgroundWaitAvailability(
  pluginConfig: OhMyOpenCodeConfig,
  isWaitToolRegistered: () => boolean,
): (sessionID: string) => boolean {
  return (sessionID): boolean => {
    if (!isWaitToolRegistered()) return false

    const sessionToolOverride = getSessionTools(sessionID)?.[BACKGROUND_WAIT_TOOL]
    if (sessionToolOverride !== undefined) return sessionToolOverride

    const sessionAgent = getSessionAgent(sessionID)
    if (!sessionAgent) return true

    const agentOverride = pluginConfig.agents?.[getAgentConfigKey(sessionAgent)]
    let effectivePermission: "allow" | "ask" | "deny" | undefined
    for (const [permission, action] of Object.entries(agentOverride?.permission ?? {})) {
      if (matchesToolMatcher(BACKGROUND_WAIT_TOOL, permission)) {
        effectivePermission = action
      }
    }
    if (effectivePermission !== undefined) return effectivePermission !== "deny"

    const legacyToolOverride = agentOverride?.tools?.[BACKGROUND_WAIT_TOOL]
    if (legacyToolOverride !== undefined) return legacyToolOverride

    return true
  }
}
