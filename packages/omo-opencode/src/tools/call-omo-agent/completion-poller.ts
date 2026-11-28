import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { normalizeSDKResponse } from "../../shared"

/** How long a foreground call_omo_agent waits in total when `background_task.syncPollTimeoutMs` is unset. */
export const DEFAULT_CALL_OMO_AGENT_WAIT_MS = 5 * 60 * 1000

export async function waitForCompletion(
  sessionID: string,
  toolContext: {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  },
  ctx: PluginInput,
  timeoutMs: number = DEFAULT_CALL_OMO_AGENT_WAIT_MS,
  /** Aborts when the child is to be handed to the background: the wait returns "handed-off" and leaves it running. */
  handoffSignal?: AbortSignal,
): Promise<"completed" | "handed-off"> {
  log(`[call_omo_agent] Polling for completion...`)

  const POLL_INTERVAL_MS = 500
  const MAX_POLL_TIME_MS = timeoutMs === 0 ? Number.POSITIVE_INFINITY : timeoutMs
  const PROMPT_ACCEPTANCE_TIMEOUT_MS = 30 * 1000
  const pollStart = Date.now()
  let lastMsgCount = 0
  let stablePolls = 0
  const STABILITY_REQUIRED = 3
  let sawActiveStatus = false

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    if (toolContext.abort?.aborted) {
      log(`[call_omo_agent] Aborted by user`)
      throw new Error("Task aborted.")
    }
    if (handoffSignal?.aborted) {
      log(`[call_omo_agent] Handing the child to the background`)
      return "handed-off"
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const statusResult = await ctx.client.session.status()
    const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
    const sessionStatus = allStatuses[sessionID]

    if (sessionStatus && sessionStatus.type !== "idle") {
      sawActiveStatus = true
      stablePolls = 0
      lastMsgCount = 0
      continue
    }

    const messagesCheck = await ctx.client.session.messages({ path: { id: sessionID } })
    const msgs = normalizeSDKResponse(messagesCheck, [] as Array<unknown>, {
      preferResponseOnMissingData: true,
    })
    const currentMsgCount = msgs.length

    if (currentMsgCount === 0) {
      stablePolls = 0
      lastMsgCount = 0
      if (!sawActiveStatus && Date.now() - pollStart >= PROMPT_ACCEPTANCE_TIMEOUT_MS) {
        throw new Error(`Prompt was not durably accepted by OpenCode for session ${sessionID}.`)
      }
      continue
    }

    if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
      stablePolls++
      if (stablePolls >= STABILITY_REQUIRED) {
        log(`[call_omo_agent] Session complete, ${currentMsgCount} messages`)
        break
      }
    } else {
      stablePolls = 0
      lastMsgCount = currentMsgCount
    }
  }

  if (Date.now() - pollStart >= MAX_POLL_TIME_MS) {
    log(`[call_omo_agent] Timeout reached`)
    throw new Error(
      `Agent task timed out after ${Math.round(MAX_POLL_TIME_MS / 60000)} minutes (background_task.syncPollTimeoutMs).`,
    )
  }
  return "completed"
}
