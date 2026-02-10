import type { PluginInput } from "@opencode-ai/plugin"
import type { ExperimentalConfig } from "../../config"
import { log } from "../../shared/logger"
import { detectErrorType } from "./detect-error-type"
import type { RecoveryErrorType } from "./detect-error-type"
import type { MessageData } from "./types"
import { recoverToolResultMissing } from "./recover-tool-result-missing"
import { recoverThinkingBlockOrder } from "./recover-thinking-block-order"
import { recoverThinkingDisabledViolation } from "./recover-thinking-disabled-violation"
import { extractResumeConfig, findLastUserMessage, resumeSession } from "./resume"

interface MessageInfo {
  id?: string
  role?: string
  sessionID?: string
  parentID?: string
  error?: unknown
}

export interface SessionRecoveryOptions {
  experimental?: ExperimentalConfig
}

export interface SessionRecoveryHook {
  handleSessionRecovery: (info: MessageInfo) => Promise<boolean>
  isRecoverableError: (error: unknown) => boolean
  setOnAbortCallback: (callback: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void
}

export function createSessionRecoveryHook(ctx: PluginInput, options?: SessionRecoveryOptions): SessionRecoveryHook {
  const processingErrors = new Set<string>()
  const experimental = options?.experimental
  let onAbortCallback: ((sessionID: string) => void) | null = null
  let onRecoveryCompleteCallback: ((sessionID: string) => void) | null = null

  const setOnAbortCallback = (callback: (sessionID: string) => void): void => {
    onAbortCallback = callback
  }

  const setOnRecoveryCompleteCallback = (callback: (sessionID: string) => void): void => {
    onRecoveryCompleteCallback = callback
  }

  const isRecoverableError = (error: unknown): boolean => {
    return detectErrorType(error) !== null
  }

  const handleSessionRecovery = async (info: MessageInfo): Promise<boolean> => {
    if (!info || info.role !== "assistant" || !info.error) return false

    const errorType = detectErrorType(info.error)
    if (!errorType) return false

    const sessionID = info.sessionID
    const assistantMsgID = info.id

    if (!sessionID || !assistantMsgID) return false
    if (processingErrors.has(assistantMsgID)) return false
    processingErrors.add(assistantMsgID)

    try {
      if (onAbortCallback) {
        onAbortCallback(sessionID)
      }

      await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})

      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const msgs = (messagesResp as { data?: MessageData[] }).data

      const failedMsg = msgs?.find((m) => m.info?.id === assistantMsgID)
      if (!failedMsg) {
        return false
      }

      const toastTitles: Record<RecoveryErrorType & string, string> = {
        tool_result_missing: "Tool Crash Recovery",
        thinking_block_order: "Thinking Block Recovery",
        thinking_disabled_violation: "Thinking Strip Recovery",
        "assistant_prefill_unsupported": "Prefill Unsupported",
      }
      const toastMessages: Record<RecoveryErrorType & string, string> = {
        tool_result_missing: "Injecting cancelled tool results...",
        thinking_block_order: "Fixing message structure...",
        thinking_disabled_violation: "Stripping thinking blocks...",
        "assistant_prefill_unsupported": "Prefill not supported; continuing without recovery.",
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
        success = await recoverToolResultMissing(ctx.client, sessionID, failedMsg)
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
        success = false
      }

      return success
    } catch (err) {
      log("[session-recovery] Recovery failed:", err)
      return false
    } finally {
      processingErrors.delete(assistantMsgID)

      if (sessionID && onRecoveryCompleteCallback) {
        onRecoveryCompleteCallback(sessionID)
      }
    }
  }

  return {
    handleSessionRecovery,
    isRecoverableError,
    setOnAbortCallback,
    setOnRecoveryCompleteCallback,
  }
}
