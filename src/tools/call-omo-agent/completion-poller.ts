import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"

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

  // Poll for session completion
  const POLL_INTERVAL_MS = 500
  const MAX_POLL_TIME_MS = 5 * 60 * 1000 // 5 minutes max
  const pollStart = Date.now()
  let lastMsgCount = 0
  let stablePolls = 0
  const STABILITY_REQUIRED = 3

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    // Check if aborted
    if (toolContext.abort?.aborted) {
      log(`[call_omo_agent] Aborted by user`)
      throw new Error("Task aborted.")
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

    // Check session status
    const statusResult = await ctx.client.session.status()
    const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
    const sessionStatus = allStatuses[sessionID]

    // If session is actively running, reset stability counter
    if (sessionStatus && sessionStatus.type !== "idle") {
      stablePolls = 0
      lastMsgCount = 0
      continue
    }

    // Session is idle - check message stability
    const messagesCheck = await ctx.client.session.messages({ path: { id: sessionID } })
    const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
    const currentMsgCount = msgs.length

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
