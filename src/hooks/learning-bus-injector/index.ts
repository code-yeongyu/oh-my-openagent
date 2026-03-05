import type { PluginInput } from "@opencode-ai/plugin"

import { log } from "../../shared/logger"

import { HOOK_NAME, DEFAULT_SKIP_AGENTS } from "./constants"
import { handleSessionIdle } from "./session-handler"

export type LearningBusInjectorHook = ReturnType<typeof createLearningBusInjectorHook>

export function createLearningBusInjectorHook(
  ctx: PluginInput,
  options: { skipAgents?: string[] } = {},
) {
  const { skipAgents = DEFAULT_SKIP_AGENTS } = options
  const injectedSessions = new Set<string>()

  const event = async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
    if (input.event.type === "session.deleted") {
      const props = input.event.properties as Record<string, unknown> | undefined
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        injectedSessions.delete(sessionInfo.id)
      }
      return
    }

    if (input.event.type !== "session.idle") return

    const props = input.event.properties as Record<string, unknown> | undefined
    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    if (injectedSessions.has(sessionID)) return
    injectedSessions.add(sessionID)

    try {
      await handleSessionIdle(ctx, sessionID, skipAgents)
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to inject`, { sessionID, error: String(error) })
      injectedSessions.delete(sessionID)
    }
  }

  return { event }
}
