import type { PluginInput } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { ExperimentalConfig } from "../../config"
import {
  findEmptyMessages,
  findEmptyMessageByIndex,
  findMessageByIndexNeedingThinking,
  findMessagesWithEmptyTextParts,
  findMessagesWithOrphanThinking,
  findMessagesWithThinkingBlocks,
  findMessagesWithThinkingOnly,
  injectTextPart,
  prependThinkingPart,
  readParts,
  replaceEmptyTextParts,
  stripThinkingParts,
} from "./storage"
import type { MessageData, ResumeConfig } from "./types"

export interface SessionRecoveryOptions {
  experimental?: ExperimentalConfig
}

type Client = ReturnType<typeof createOpencodeClient>

type RecoveryErrorType =
  | "tool_result_missing"
  | "thinking_block_order"
  | "thinking_disabled_violation"
  | null

interface MessageInfo {
  id?: string
  role?: string
  sessionID?: string
  parentID?: string
  error?: unknown
}

interface ToolUsePart {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

interface MessagePart {
  type: string
  id?: string
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
}

const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]"

function findLastUserMessage(messages: MessageData[]): MessageData | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info?.role === "user") {
      return messages[i]
    }
  }
  return undefined
}

function extractResumeConfig(userMessage: MessageData | undefined, sessionID: string): ResumeConfig {
  return {
    sessionID,
    agent: userMessage?.info?.agent,
    model: userMessage?.info?.model,
  }
}

async function resumeSession(client: Client, config: ResumeConfig): Promise<boolean> {
  try {
    await client.session.prompt({
      path: { id: config.sessionID },
      body: {
        parts: [{ type: "text", text: RECOVERY_RESUME_TEXT }],
        agent: config.agent,
        model: config.model,
      },
    })
    return true
  } catch {
    return false
  }
}

function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  const paths = [
    errorObj.data,
    errorObj.error,
    errorObj,
    (errorObj.data as Record<string, unknown>)?.error,
  ]

  for (const obj of paths) {
    if (obj && typeof obj === "object") {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) {
        return msg.toLowerCase()
      }
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

function extractMessageIndex(error: unknown): number | null {
  const message = getErrorMessage(error)
  const match = message.match(/messages\.(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

export function detectErrorType(error: unknown): RecoveryErrorType {
  const message = getErrorMessage(error)

  if (message.includes("tool_use") && message.includes("tool_result")) {
    return "tool_result_missing"
  }

  if (
    message.includes("thinking") &&
    (message.includes("first block") ||
      message.includes("must start with") ||
      message.includes("preceeding") ||
      message.includes("final block") ||
      message.includes("cannot be thinking") ||
      (message.includes("expected") && message.includes("found")))
  ) {
    return "thinking_block_order"
  }

  if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
    return "thinking_disabled_violation"
  }

  return null
}

function extractToolUseIds(parts: MessagePart[]): string[] {
  return parts.filter((p): p is ToolUsePart => p.type === "tool_use" && !!p.id).map((p) => p.id)
}

async function recoverToolResultMissing(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData
): Promise<boolean> {
  // Try API parts first, fallback to filesystem if empty
  let parts = failedAssistantMsg.parts || []
  if (parts.length === 0 && failedAssistantMsg.info?.id) {
    const storedParts = readParts(failedAssistantMsg.info.id)
    parts = storedParts.map((p) => ({
      type: p.type === "tool" ? "tool_use" : p.type,
      id: "callID" in p ? (p as { callID?: string }).callID : p.id,
      name: "tool" in p ? (p as { tool?: string }).tool : undefined,
      input: "state" in p ? (p as { state?: { input?: Record<string, unknown> } }).state?.input : undefined,
    }))
  }
  const toolUseIds = extractToolUseIds(parts)

  if (toolUseIds.length === 0) {
    return false
  }

  const toolResultParts = toolUseIds.map((id) => ({
    type: "tool_result" as const,
    tool_use_id: id,
    content: "Operation cancelled by user (ESC pressed)",
  }))

  try {
    await client.session.prompt({
      path: { id: sessionID },
      // @ts-expect-error - SDK types may not include tool_result parts
      body: { parts: toolResultParts },
    })

    return true
  } catch {
    return false
  }
}

async function recoverThinkingBlockOrder(
  _client: Client,
  sessionID: string,
  _failedAssistantMsg: MessageData,
  _directory: string,
  error: unknown
): Promise<boolean> {
  const targetIndex = extractMessageIndex(error)
  if (targetIndex !== null) {
    const targetMessageID = findMessageByIndexNeedingThinking(sessionID, targetIndex)
    if (targetMessageID) {
      return prependThinkingPart(sessionID, targetMessageID)
    }
  }

  const orphanMessages = findMessagesWithOrphanThinking(sessionID)

  if (orphanMessages.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of orphanMessages) {
    if (prependThinkingPart(sessionID, messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

async function recoverThinkingDisabledViolation(
  _client: Client,
  sessionID: string,
  _failedAssistantMsg: MessageData
): Promise<boolean> {
  const messagesWithThinking = findMessagesWithThinkingBlocks(sessionID)

  if (messagesWithThinking.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of messagesWithThinking) {
    if (stripThinkingParts(messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

const PLACEHOLDER_TEXT = "[user interrupted]"

async function recoverEmptyContentMessage(
  _client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  _directory: string,
  error: unknown
): Promise<boolean> {
  const targetIndex = extractMessageIndex(error)
  const failedID = failedAssistantMsg.info?.id
  let anySuccess = false

  const messagesWithEmptyText = findMessagesWithEmptyTextParts(sessionID)
  for (const messageID of messagesWithEmptyText) {
    if (replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
  }

  const thinkingOnlyIDs = findMessagesWithThinkingOnly(sessionID)
  for (const messageID of thinkingOnlyIDs) {
    if (injectTextPart(sessionID, messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
  }

  if (targetIndex !== null) {
    const targetMessageID = findEmptyMessageByIndex(sessionID, targetIndex)
    if (targetMessageID) {
      if (replaceEmptyTextParts(targetMessageID, PLACEHOLDER_TEXT)) {
        return true
      }
      if (injectTextPart(sessionID, targetMessageID, PLACEHOLDER_TEXT)) {
        return true
      }
    }
  }

  if (failedID) {
    if (replaceEmptyTextParts(failedID, PLACEHOLDER_TEXT)) {
      return true
    }
    if (injectTextPart(sessionID, failedID, PLACEHOLDER_TEXT)) {
      return true
    }
  }

  const emptyMessageIDs = findEmptyMessages(sessionID)
  for (const messageID of emptyMessageIDs) {
    if (replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
    if (injectTextPart(sessionID, messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
  }

  return anySuccess
}

// NOTE: fallbackRevertStrategy was removed (2025-12-08)
// Reason: Function was defined but never called - no error recovery paths used it.
// All error types have dedicated recovery functions (recoverToolResultMissing,
// recoverThinkingBlockOrder, recoverThinkingDisabledViolation, recoverEmptyContentMessage).

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
        onAbortCallback(sessionID)  // Mark recovering BEFORE abort
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
      }
      const toastMessages: Record<RecoveryErrorType & string, string> = {
        tool_result_missing: "Injecting cancelled tool results...",
        thinking_block_order: "Fixing message structure...",
        thinking_disabled_violation: "Stripping thinking blocks...",
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
      }

      return success
  } catch (err) {
    console.error("[session-recovery] Recovery failed:", err)
    return false
  } finally {
    processingErrors.delete(assistantMsgID)

    // Always notify recovery complete, regardless of success or failure
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
