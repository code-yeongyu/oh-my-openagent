import type { ToolContextWithMetadata, OpencodeClient } from "./types"
import { getTimingConfig } from "./timing"
import { log } from "../../shared"

export async function pollSyncSession(
  ctx: ToolContextWithMetadata,
  client: OpencodeClient,
  input: {
    sessionID: string
    agentToUse: string
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
  }
): Promise<string | null> {
  const syncTiming = getTimingConfig()
  const pollStart = Date.now()
  let lastMsgCount = 0
  let stablePolls = 0
  let pollCount = 0

  log("[task] Starting poll loop", { sessionID: input.sessionID, agentToUse: input.agentToUse })

  while (Date.now() - pollStart < syncTiming.MAX_POLL_TIME_MS) {
    if (ctx.abort?.aborted) {
      log("[task] Aborted by user", { sessionID: input.sessionID })
      if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
      return `Task aborted.\n\nSession ID: ${input.sessionID}`
    }

    await new Promise(resolve => setTimeout(resolve, syncTiming.POLL_INTERVAL_MS))
    pollCount++

    const statusResult = await client.session.status()
    const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
    const sessionStatus = allStatuses[input.sessionID]

    if (pollCount % 10 === 0) {
    log("[task] Poll status", {
        sessionID: input.sessionID,
        pollCount,
        elapsed: Math.floor((Date.now() - pollStart) / 1000) + "s",
        sessionStatus: sessionStatus?.type ?? "not_in_status",
        stablePolls,
        lastMsgCount,
      })
    }

    if (sessionStatus && sessionStatus.type !== "idle") {
      stablePolls = 0
      lastMsgCount = 0
      continue
    }

    const elapsed = Date.now() - pollStart
    if (elapsed < syncTiming.MIN_STABILITY_TIME_MS) {
      continue
    }

    const messagesCheck = await client.session.messages({ path: { id: input.sessionID } })
    const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
    const currentMsgCount = msgs.length

    if (currentMsgCount === lastMsgCount) {
      stablePolls++
      if (stablePolls >= syncTiming.STABILITY_POLLS_REQUIRED) {
      log("[task] Poll complete - messages stable", { sessionID: input.sessionID, pollCount, currentMsgCount })
        break
      }
    } else {
      stablePolls = 0
      lastMsgCount = currentMsgCount
    }
  }

  if (Date.now() - pollStart >= syncTiming.MAX_POLL_TIME_MS) {
  log("[task] Poll timeout reached", { sessionID: input.sessionID, pollCount, lastMsgCount, stablePolls })
  }

  return null
}
