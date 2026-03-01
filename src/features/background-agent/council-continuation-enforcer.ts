import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask } from "./types"
import {
  log,
  getAgentToolRestrictions,
  createInternalAgentTextPart,
} from "../../shared"
import { setSessionTools } from "../../shared/session-tools-store"
import { extractCouncilResponse } from "../../tools/council-archive/council-response-extractor"
import { COUNCIL_MEMBER_KEY_PREFIX } from "../../agents/builtin-agents/council-member-agents"

type OpencodeClient = PluginInput["client"]

const CONTINUATION_PROMPT =
  "You have not yet produced your final <COUNCIL_MEMBER_RESPONSE>. Continue your analysis and wrap your findings in <COUNCIL_MEMBER_RESPONSE> tags. If you are waiting for background tasks, use background_wait to block until they complete, then produce your response."

const MAX_NUDGE_ATTEMPTS = 5

const nudgeCountByTask = new Map<string, number>()

export function isCouncilMemberAgent(agentName: string | undefined): boolean {
  return !!agentName?.startsWith(COUNCIL_MEMBER_KEY_PREFIX)
}

export function resetCouncilNudgeCount(taskId: string): void {
  nudgeCountByTask.delete(taskId)
}

export function hasCouncilResponseTag(sessionMessages: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }>): boolean {
  const assistantTexts: string[] = []
  for (const msg of sessionMessages) {
    if (msg.info?.role !== "assistant") continue
    for (const part of msg.parts ?? []) {
      if (part.type === "text" && part.text) {
        assistantTexts.push(part.text)
      }
    }
  }
  if (assistantTexts.length === 0) return false
  const extraction = extractCouncilResponse(assistantTexts.join("\n"))
  return extraction.has_response && extraction.response_complete
}

export function sendCouncilContinuationNudge(
  client: OpencodeClient,
  task: BackgroundTask,
  sessionID: string,
): boolean {
  if (task.status !== "running") return false

  const count = nudgeCountByTask.get(task.id) ?? 0
  if (count >= MAX_NUDGE_ATTEMPTS) {
    log("[council-continuation] Max nudge attempts reached, allowing completion:", {
      taskId: task.id,
      attempts: count,
    })
    nudgeCountByTask.delete(task.id)
    return false
  }

  nudgeCountByTask.set(task.id, count + 1)
  const resumeModel = task.model
    ? { providerID: task.model.providerID, modelID: task.model.modelID }
    : undefined
  const resumeVariant = task.model?.variant

  log("[council-continuation] Nudging council member to produce response:", {
    taskId: task.id,
    attempt: count + 1,
    maxAttempts: MAX_NUDGE_ATTEMPTS,
  })

  client.session.promptAsync({
    path: { id: sessionID },
    body: {
      agent: task.agent,
      ...(resumeModel ? { model: resumeModel } : {}),
      ...(resumeVariant ? { variant: resumeVariant } : {}),
      tools: (() => {
        const tools = {
          task: false,
          call_omo_agent: true,
          question: false,
          ...getAgentToolRestrictions(task.agent),
        }
        setSessionTools(sessionID, tools)
        return tools
      })(),
      parts: [createInternalAgentTextPart(CONTINUATION_PROMPT)],
    },
  }).catch((error) => {
    nudgeCountByTask.set(task.id, count)
    log("[council-continuation] Nudge prompt error:", {
      taskId: task.id,
      error: String(error),
    })
  })

  if (task.progress) {
    task.progress.lastUpdate = new Date()
  }

  return true
}