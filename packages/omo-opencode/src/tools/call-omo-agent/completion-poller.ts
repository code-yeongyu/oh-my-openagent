import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { normalizeSDKResponse } from "../../shared"
import { extractErrorMessage } from "../../features/background-agent/error-classifier"
import type { SessionMessage } from "../delegate-task/executor-types"
import { getTerminalSessionError, isSessionComplete } from "../delegate-task/sync-session-turns"
import { COMPLETION_TIMEOUT_MS, withCompletionDeadline } from "./completion-deadline"

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
  anchorMessageID?: string,
): Promise<void> {
  return withCompletionDeadline(toolContext.abort, (signal) => pollForCompletion(sessionID, ctx, signal, anchorMessageID))
}

async function pollForCompletion(
  sessionID: string,
  ctx: PluginInput,
  signal: AbortSignal,
  anchorMessageID?: string,
): Promise<void> {
  log(`[call_omo_agent] Polling for completion...`)

  const POLL_INTERVAL_MS = 500
  const MAX_POLL_TIME_MS = COMPLETION_TIMEOUT_MS // 5 minutes max
  const PROMPT_ACCEPTANCE_TIMEOUT_MS = 30 * 1000
  const pollStart = Date.now()
  let sawActiveStatus = false

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    signal.throwIfAborted()

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

    signal.throwIfAborted()
    const statusResult = await ctx.client.session.status({ signal })
    signal.throwIfAborted()
    if (statusResult.error) {
      throw new Error(`Failed to get session status: ${extractErrorMessage(statusResult.error) ?? "Unknown SDK error"}`)
    }
    const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
    const sessionStatus = allStatuses[sessionID]

    if (sessionStatus && sessionStatus.type !== "idle") {
      sawActiveStatus = true
      continue
    }

    const messagesCheck = await ctx.client.session.messages({ path: { id: sessionID }, signal })
    signal.throwIfAborted()
    if (messagesCheck.error) {
      throw new Error(`Failed to get messages: ${extractErrorMessage(messagesCheck.error) ?? "Unknown SDK error"}`)
    }
    const msgs = normalizeSDKResponse(messagesCheck, [] as SessionMessage[], {
      preferResponseOnMissingData: true,
    })
    const currentMessages = anchorMessageID
      ? msgs.filter((message) => message.info?.id && message.info.id > anchorMessageID)
      : msgs
    const currentMsgCount = currentMessages.length

    if (currentMsgCount === 0) {
      if (!sawActiveStatus && Date.now() - pollStart >= PROMPT_ACCEPTANCE_TIMEOUT_MS) {
        throw new Error(`Prompt was not durably accepted by OpenCode for session ${sessionID}.`)
      }
      continue
    }

    const sessionError = getTerminalSessionError(currentMessages)
    if (sessionError) throw new Error(`Agent task failed: ${sessionError}`)

    if (isSessionComplete(currentMessages)) {
      log(`[call_omo_agent] Session complete, ${currentMsgCount} messages`)
      return
    }
  }

  if (Date.now() - pollStart >= MAX_POLL_TIME_MS) {
    log(`[call_omo_agent] Timeout reached`)
    throw new Error("Agent task timed out after 5 minutes.")
  }
}
