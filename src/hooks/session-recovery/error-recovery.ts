import type { PluginInput } from "@opencode-ai/plugin"
import type { ExperimentalConfig } from "../../config"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { detectErrorType } from "./detect-error-type"
import type { RecoveryErrorType } from "./detect-error-type"
import { recoverThinkingBlockOrder } from "./recover-thinking-block-order"
import { recoverThinkingDisabledViolation } from "./recover-thinking-disabled-violation"
import { recoverToolResultMissing } from "./recover-tool-result-missing"
import { recoverUnavailableTool } from "./recover-unavailable-tool"
import { extractResumeConfig, findLastUserMessage, resumeSession } from "./resume"
import type { MessageInfo, SessionRecoveryCallbacks } from "./hook-types"
import type { MessageData } from "./types"

const toastTitles: Record<RecoveryErrorType & string, string> = {
  tool_result_missing: "Tool Crash Recovery",
  unavailable_tool: "Tool Recovery",
  thinking_block_order: "Thinking Block Recovery",
  thinking_disabled_violation: "Thinking Strip Recovery",
  thinking_block_modified: "Thinking Block Recovery",
  assistant_prefill_unsupported: "Prefill Unsupported",
}

const toastMessages: Record<RecoveryErrorType & string, string> = {
  tool_result_missing: "Injecting cancelled tool results...",
  unavailable_tool: "Recovering from unavailable tool call...",
  thinking_block_order: "Fixing message structure...",
  thinking_disabled_violation: "Stripping thinking blocks...",
  thinking_block_modified: "Leaving latest thinking blocks unchanged...",
  assistant_prefill_unsupported: "Prefill not supported; continuing without recovery.",
}

export function createSessionErrorRecoveryHandler(
  ctx: PluginInput,
  callbacks: SessionRecoveryCallbacks,
  experimental?: ExperimentalConfig,
): (info: MessageInfo) => Promise<boolean> {
  const processingErrors = new Set<string>()

  return async (info: MessageInfo): Promise<boolean> => {
    if (!info || info.role !== "assistant" || !info.error) return false

    const errorType = detectErrorType(info.error)
    if (!errorType) return false

    const sessionID = info.sessionID
    let assistantMsgID = info.id

    if (!sessionID) return false

    if (!assistantMsgID) {
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })
        const msgs = normalizeSDKResponse(messagesResp, [] as MessageData[])
        const lastAssistant = msgs?.findLast((m) => m.info?.role === "assistant" && m.info?.error)
        assistantMsgID = lastAssistant?.info?.id
      } catch {
        log("[session-recovery] Failed to fetch messages for messageID fallback", { sessionID })
      }
    }

    if (!assistantMsgID) return false
    if (processingErrors.has(assistantMsgID)) return false
    processingErrors.add(assistantMsgID)
    let shouldKeepProcessingError = false

    try {
      if (errorType === "thinking_block_modified") {
        shouldKeepProcessingError = true
        log("[session-recovery] Refusing to mutate latest assistant thinking blocks", {
          sessionID,
          assistantMsgID,
        })
        await ctx.client.tui
          .showToast({
            body: {
              title: "Thinking Block Recovery",
              message: "Latest assistant thinking blocks cannot be safely recovered; leaving history unchanged.",
              variant: "warning",
              duration: 3000,
            },
          })
          .catch((error: unknown) => {
            log("[session-recovery] Failed to show thinking block modified toast", {
              sessionID,
              error,
            })
          })
        return false
      }

      if (callbacks.onAbortCallback) {
        callbacks.onAbortCallback(sessionID)
      }

      await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})

      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const msgs = normalizeSDKResponse(messagesResp, [] as MessageData[])

      const failedMsg = msgs?.find((m) => m.info?.id === assistantMsgID)
      if (!failedMsg) {
        return false
      }

      await ctx.client.tui
        .showToast({
          body: {
            title: toastTitles[errorType],
            message: toastMessages[errorType],
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})

      let success = false

      if (errorType === "tool_result_missing") {
        const lastUser = findLastUserMessage(msgs ?? [])
        const resumeConfig = extractResumeConfig(lastUser, sessionID)
        success = await recoverToolResultMissing(ctx.client, sessionID, failedMsg, resumeConfig)
      } else if (errorType === "unavailable_tool") {
        success = await recoverUnavailableTool(ctx.client, sessionID, failedMsg)
      } else if (errorType === "thinking_block_order") {
        success = await recoverThinkingBlockOrder(ctx.client, sessionID, failedMsg, ctx.directory, info.error)
        if (success && experimental?.auto_resume) {
          const lastUser = findLastUserMessage(msgs ?? [])
          const resumeConfig = extractResumeConfig(lastUser, sessionID)
          await resumeSession(ctx.client, resumeConfig)
        }
      } else if (errorType === "thinking_disabled_violation") {
        success = await recoverThinkingDisabledViolation(ctx.client, sessionID, failedMsg)
        if (success && experimental?.auto_resume) {
          const lastUser = findLastUserMessage(msgs ?? [])
          const resumeConfig = extractResumeConfig(lastUser, sessionID)
          await resumeSession(ctx.client, resumeConfig)
        }
      } else if (errorType === "assistant_prefill_unsupported") {
        shouldKeepProcessingError = true
        success = false
      }

      if (success) {
        shouldKeepProcessingError = true
      }
      return success
    } catch (err) {
      log("[session-recovery] Recovery failed:", err)
      return false
    } finally {
      if (!shouldKeepProcessingError) {
        processingErrors.delete(assistantMsgID)
      }
      if (sessionID && callbacks.onRecoveryCompleteCallback) {
        callbacks.onRecoveryCompleteCallback(sessionID)
      }
    }
  }
}
