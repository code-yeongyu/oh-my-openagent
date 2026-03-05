import type { PluginInput } from "@opencode-ai/plugin"

import { createInternalAgentTextPart, normalizeSDKResponse } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"

import {
  CHECKPOINT_MESSAGE_THRESHOLD,
  CHECKPOINT_TIME_THRESHOLD_MS,
  DEFAULT_SKIP_AGENTS,
  HOOK_NAME,
} from "./constants"
import { buildCheckpointPrompt, buildRestorePrompt } from "./prompt-templates"

  const COOLDOWN_MS = 5 * 60 * 1000
  const MAX_INJECTION_CHARS = 2000

  type SessionState = {
  idleCount: number
  lastInjectionAt: number
  restoreInjected: boolean
  isSubagent: boolean | null
}

    export type AutoCheckpointHook = ReturnType<typeof createAutoCheckpointHook>

        export function createAutoCheckpointHook(
  ctx: PluginInput,
  options: { skipAgents?: string[] } = {},
      ) {
  const { skipAgents = DEFAULT_SKIP_AGENTS } = options
  const sessions = new Map<string, SessionState>()

  async function resolveAgent(sessionID: string): Promise<string | undefined> {
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
      })
      const messages = normalizeSDKResponse(messagesResp, [] as Array<{ info?: { agent?: string } }>)
      for (const msg of messages) {
        if (msg.info?.agent) return msg.info.agent
      }
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to resolve agent`, { sessionID, error: String(error) })
    }
    return undefined
  }

  function getOrCreateSession(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = { idleCount: 0, lastInjectionAt: 0, restoreInjected: false, isSubagent: null }
      sessions.set(sessionID, state)
    }
    return state
  }

  async function isSkippedAgent(sessionID: string, state: SessionState): Promise<boolean> {
    if (state.isSubagent !== null) return state.isSubagent
    const agentName = await resolveAgent(sessionID)
    if (agentName && skipAgents.some((s) => getAgentConfigKey(s) === getAgentConfigKey(agentName))) {
      state.isSubagent = true
      log(`[${HOOK_NAME}] Skipped: sub-agent session`, { sessionID, agent: agentName })
      return true
    }
    state.isSubagent = false
    return false
  }

  const event = async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
    if (input.event.type === "session.deleted") {
      const props = input.event.properties as Record<string, unknown> | undefined
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessions.delete(sessionInfo.id)
      }
      return
    }

    if (input.event.type !== "session.idle") return

    const props = input.event.properties as Record<string, unknown> | undefined
    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    const state = getOrCreateSession(sessionID)
    state.idleCount++
    const now = Date.now()

    // First idle of a fresh session: inject restore prompt
    if (state.idleCount === 1 && !state.restoreInjected) {
      if (await isSkippedAgent(sessionID, state)) return

      state.restoreInjected = true
      try {
        const prompt = buildRestorePrompt()
        await ctx.client.session.promptAsync({
          path: { id: sessionID },
          body: { parts: [createInternalAgentTextPart(prompt)] },
          query: { directory: ctx.directory },
        })
        state.lastInjectionAt = now
        log(`[${HOOK_NAME}] Injected restore prompt`, { sessionID })
      } catch (error) {
        log(`[${HOOK_NAME}] Failed to inject restore prompt`, { sessionID, error: String(error) })
        state.restoreInjected = false
      }
      return
    }

    // Cooldown: skip if last injection was less than 5min ago
    if (now - state.lastInjectionAt < COOLDOWN_MS) return

    // Check thresholds: idle count (proxy for messages) or time since last injection
    const idlesSinceLastInjection = state.idleCount
    const timeSinceLastInjection = state.lastInjectionAt === 0 ? now : now - state.lastInjectionAt

    const messageThresholdMet = idlesSinceLastInjection >= CHECKPOINT_MESSAGE_THRESHOLD
    const timeThresholdMet = timeSinceLastInjection >= CHECKPOINT_TIME_THRESHOLD_MS

    if (!messageThresholdMet && !timeThresholdMet) return

    if (await isSkippedAgent(sessionID, state)) return

    try {
      const minutesSince = Math.round(timeSinceLastInjection / 60_000)
      let prompt = buildCheckpointPrompt({
        messagesSinceCheckpoint: idlesSinceLastInjection,
        minutesSinceCheckpoint: minutesSince,
      })

      if (prompt.length > MAX_INJECTION_CHARS) {
        prompt = prompt.slice(0, MAX_INJECTION_CHARS) + "\n\n(Truncated)"
      }

      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [createInternalAgentTextPart(prompt)] },
        query: { directory: ctx.directory },
      })

      state.lastInjectionAt = now
      state.idleCount = 0

      log(`[${HOOK_NAME}] Injected checkpoint prompt`, {
        sessionID,
        idleCount: idlesSinceLastInjection,
        minutesSinceCheckpoint: minutesSince,
        trigger: messageThresholdMet ? "message-threshold" : "time-threshold",
      })
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to inject checkpoint prompt`, { sessionID, error: String(error) })
    }
  }

  return { event }
}
