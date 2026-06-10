import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import {
  getInterruptedIdleMessagesFetchTimeoutMs,
  withInterruptedIdleMessagesFetchTimeout,
} from "./interrupted-idle-message-fetch-timeout"
import {
  assistantMessageIsFinished,
  findLatestAssistantMessage,
  messageHasInterruptedToolResults,
} from "./message-state"
import { recoverToolResultMissing } from "./recover-tool-result-missing"
import { extractResumeConfig, findLastUserMessage } from "./resume"
import type { SessionRecoveryCallbacks } from "./hook-types"
import type { MessageData } from "./types"

export function createInterruptedToolResultsHandler(
  ctx: PluginInput,
  callbacks: SessionRecoveryCallbacks,
): (sessionID: string) => Promise<boolean> {
  const processingInterruptedToolMessages = new Set<string>()

  return async (sessionID: string): Promise<boolean> => {
    let recoveryStarted = false
    let assistantMessageIDForRecovery: string | undefined
    try {
      const messagesResp = await withInterruptedIdleMessagesFetchTimeout(
        ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        }),
        getInterruptedIdleMessagesFetchTimeoutMs(),
      )
      const messages = normalizeSDKResponse(messagesResp, [] as MessageData[])
      const latestAssistant = findLatestAssistantMessage(messages)
      if (!latestAssistant?.info?.id) {
        return false
      }

      if (assistantMessageIsFinished(latestAssistant) || !messageHasInterruptedToolResults(latestAssistant)) {
        return false
      }

      const assistantMessageID = latestAssistant.info.id
      if (processingInterruptedToolMessages.has(assistantMessageID)) {
        return false
      }
      processingInterruptedToolMessages.add(assistantMessageID)
      assistantMessageIDForRecovery = assistantMessageID

      if (callbacks.onAbortCallback) {
        callbacks.onAbortCallback(sessionID)
      }
      recoveryStarted = true

      const lastUser = findLastUserMessage(messages)
      const resumeConfig = extractResumeConfig(lastUser, sessionID)
      const success = await recoverToolResultMissing(ctx.client, sessionID, latestAssistant, resumeConfig, {
        recoverStatuses: new Set(["pending", "running"]),
        resultText: "Tool execution was interrupted before producing a result.",
        source: "session-recovery-interrupted-tool-results",
      })
      if (!success) {
        processingInterruptedToolMessages.delete(assistantMessageID)
      }
      return success
    } catch (err) {
      if (assistantMessageIDForRecovery) {
        processingInterruptedToolMessages.delete(assistantMessageIDForRecovery)
      }
      log("[session-recovery] Interrupted tool result recovery failed:", { sessionID, error: err })
      return false
    } finally {
      if (recoveryStarted && callbacks.onRecoveryCompleteCallback) {
        callbacks.onRecoveryCompleteCallback(sessionID)
      }
    }
  }
}
