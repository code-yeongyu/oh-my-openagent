import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { normalizeSDKResponse } from "../../shared"

export async function waitForCompletion(
  sessionID: string,
  toolContext: {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  },
  ctx: PluginInput
): Promise<void> {
  log(`[call_omo_agent] Polling for completion...`)

  const POLL_INTERVAL_MS = 500
  const MAX_POLL_TIME_MS = 5 * 60 * 1000 // 5 minutes max
  const PROMPT_ACCEPTANCE_TIMEOUT_MS = 30 * 1000
  const pollStart = Date.now()
  let lastMsgCount = 0
  let stablePolls = 0
  const STABILITY_REQUIRED = 3
  let sawActiveStatus = false
  let sawActiveStatusAt = 0 // Track when the session first became active

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    if (toolContext.abort?.aborted) {
      log(`[call_omo_agent] Aborted by user`)
      throw new Error("Task aborted.")
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

    const statusResult = await ctx.client.session.status()
    const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
    const sessionStatus = allStatuses[sessionID]

    if (sessionStatus && sessionStatus.type !== "idle") {
      if (!sawActiveStatus) {
        sawActiveStatusAt = Date.now()
      }
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
      // If session was active but no messages arrived within 15s, suspect dispatch failure
      if (sawActiveStatus && Date.now() - sawActiveStatusAt >= 15_000) {
        throw new Error(
          `Session ${sessionID} was briefly active but no messages arrived within 15 seconds. ` +
          `The prompt dispatch likely failed without being durably accepted.`,
        )
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
    throw new Error("Agent task timed out after 5 minutes.")
  }
}
