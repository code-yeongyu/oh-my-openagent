import type { PluginInput } from "@opencode-ai/plugin"

import { createInternalAgentTextPart, normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { getAgentConfigKey } from "../../shared/agent-display-names"

import { HOOK_NAME, MAX_INJECTION_CHARS } from "./constants"
import { loadAndRankEvents, type SystemEvent } from "./event-reader"

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatInjection(events: SystemEvent[]): string {
  const lines = events.map((event, i) => {
    const date = formatDate(event.timestamp)
    const confidence = event.confidence ?? 0.8
    const tags = event.domain_tags.length > 0
      ? `\n   Tags: ${event.domain_tags.join(", ")}`
      : ""
    return `${i + 1}. [${event.event_type}] (${date}, confidence: ${confidence}) \u2014 ${event.content}${tags}`
  })

  return `[SYSTEM REMINDER - LEARNING BUS]

Recent system intelligence (from previous sessions):

${lines.join("\n\n")}

Apply corrections as constraints. Consider discoveries and patterns when making decisions. Flag if any learning conflicts with your current task.`
}

async function resolveAgent(
  ctx: PluginInput,
  sessionID: string,
): Promise<string | undefined> {
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

export async function handleSessionIdle(
  ctx: PluginInput,
  sessionID: string,
  skipAgents: string[],
): Promise<void> {
  const agentName = await resolveAgent(ctx, sessionID)
  if (agentName && skipAgents.some(s => getAgentConfigKey(s) === getAgentConfigKey(agentName))) {
    log(`[${HOOK_NAME}] Skipped: sub-agent session`, { sessionID, agent: agentName })
    return
  }

  const events = loadAndRankEvents()
  if (events.length === 0) {
    log(`[${HOOK_NAME}] No events to inject`, { sessionID })
    return
  }

  let eventsToInject = events
  let prompt = formatInjection(eventsToInject)
  while (prompt.length > MAX_INJECTION_CHARS && eventsToInject.length > 1) {
    eventsToInject = eventsToInject.slice(0, eventsToInject.length - 1)
    prompt = formatInjection(eventsToInject)
  }

  await ctx.client.session.promptAsync({
    path: { id: sessionID },
    body: {
      parts: [createInternalAgentTextPart(prompt)],
    },
    query: { directory: ctx.directory },
  })

  log(`[${HOOK_NAME}] Injected ${eventsToInject.length} events`, { sessionID })
}
