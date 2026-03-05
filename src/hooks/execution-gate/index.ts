import type { PluginInput } from "@opencode-ai/plugin"

import { createInternalAgentTextPart, normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { getAgentConfigKey } from "../../shared/agent-display-names"

import { HOOK_NAME, MAX_INJECTION_CHARS, DEFAULT_SKIP_AGENTS } from "./constants"
import { loadRecentDecisions, loadFlightPlan, loadSessionStartCorrections } from "./readers"
import { formatExecutionGateBriefing } from "./formatter"

export type ExecutionGateHook = ReturnType<typeof createExecutionGateHook>

export function createExecutionGateHook(
  ctx: PluginInput,
  options: { skipAgents?: string[] } = {},
) {
  const { skipAgents = DEFAULT_SKIP_AGENTS } = options
  const injectedSessions = new Set<string>()

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

    const agentName = await resolveAgent(sessionID)
    if (agentName && skipAgents.some((s) => getAgentConfigKey(s) === getAgentConfigKey(agentName))) {
      log(`[${HOOK_NAME}] Skipped: sub-agent session`, { sessionID, agent: agentName })
      return
    }

    try {
      const plan = loadFlightPlan()
      const decisions = loadRecentDecisions()
      const corrections = loadSessionStartCorrections()

      let briefing = formatExecutionGateBriefing(plan, decisions, corrections)
      if (!briefing) {
        log(`[${HOOK_NAME}] No briefing to inject`, { sessionID })
        return
      }

      if (briefing.length > MAX_INJECTION_CHARS) {
        briefing = briefing.slice(0, MAX_INJECTION_CHARS) + "\n\n(Truncated)"
      }

      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [createInternalAgentTextPart(briefing)],
        },
        query: { directory: ctx.directory },
      })

      log(`[${HOOK_NAME}] Injected briefing`, {
        sessionID,
        flightPlan: plan !== null,
        decisions: decisions.length,
        corrections: corrections.length,
        chars: briefing.length,
      })
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to inject`, { sessionID, error: String(error) })
      injectedSessions.delete(sessionID)
    }
  }

  return { event }
}
