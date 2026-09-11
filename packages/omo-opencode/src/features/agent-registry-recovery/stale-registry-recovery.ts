import { isAgentRegistered } from "../claude-code-session-state"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { log } from "../../shared/logger"
import {
  getLastRecoveryAttemptAt,
  getAppliedRegistry,
  markRecoveryAttempted,
} from "./registry-snapshot"

/**
 * Self-heal for issue #4856: after /connect (or any instance recreation race),
 * OpenCode's per-instance Agent registry can freeze without OMO agents even
 * though the config hook applied them. OpenCode only rebuilds that registry
 * when the instance is disposed and recreated, so when we detect our agents
 * are missing from the live list we dispose the instance once per cooldown
 * window. The next request bootstraps a fresh instance whose startup awaits
 * plugin config hooks before serving traffic, restoring the agents.
 */

export const DEFAULT_RECOVERY_COOLDOWN_MS = 30_000

export interface AgentRegistryClient {
  app: { agents: () => Promise<unknown> }
  instance: { dispose: () => Promise<unknown> }
}

type LiveAgent = { name?: unknown }

function extractLiveAgentNames(response: unknown): string[] {
  const agents = normalizeSDKResponse<LiveAgent[]>(response, [])
  if (!Array.isArray(agents)) return []
  return agents
    .map((agent) => (agent !== null && typeof agent === "object" ? agent.name : undefined))
    .filter((name): name is string => typeof name === "string")
}

export function createStaleAgentRegistryRecovery(deps: {
  client: AgentRegistryClient
  now?: () => number
  cooldownMs?: number
}) {
  const { client } = deps
  const now = deps.now ?? Date.now
  const cooldownMs = deps.cooldownMs ?? DEFAULT_RECOVERY_COOLDOWN_MS

  return {
    /** Returns true when a stale registry was detected and a recovery was triggered. */
    async maybeRecover(): Promise<boolean> {
      const appliedNames = getAppliedRegistry()
      if (appliedNames.length === 0) return false

      const lastAttempt = getLastRecoveryAttemptAt()
      if (now() - lastAttempt < cooldownMs) return false

      let liveNames: string[]
      try {
        liveNames = extractLiveAgentNames(await client.app.agents())
      } catch (err) {
        log("[agent-registry-recovery] failed to query live agents", {
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }

      const hasAppliedAgent = liveNames.some((name) => isAgentRegistered(name))
      if (hasAppliedAgent) return false

      markRecoveryAttempted(now())
      log("[agent-registry-recovery] applied OMO agents missing from live registry; disposing instance to force rebuild", {
        appliedCount: appliedNames.length,
        liveCount: liveNames.length,
      })
      try {
        await client.instance.dispose()
      } catch (err) {
        log("[agent-registry-recovery] instance dispose failed", {
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }
      return true
    },
  }
}
