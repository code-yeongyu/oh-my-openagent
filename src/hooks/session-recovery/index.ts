import type { PluginInput } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { findFirstEmptyMessage, injectTextPart } from "./storage"
import type { MessageData } from "./types"

type Client = ReturnType<typeof createOpencodeClient>

type RecoveryErrorType =
  | "tool_result_missing"
  | "thinking_block_order"
  | "thinking_disabled_violation"
  | "empty_content_message"
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

interface ThinkingPart {
  type: "thinking"
  thinking: string
}

interface MessagePart {
  type: string
  id?: string
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
}

function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()
  const errorObj = error as { data?: { message?: string }; message?: string }
  return (errorObj.data?.message || errorObj.message || "").toLowerCase()
}

function detectErrorType(error: unknown): RecoveryErrorType {
  const message = getErrorMessage(error)

  if (message.includes("tool_use") && message.includes("tool_result")) {
    return "tool_result_missing"
  }

  if (
    message.includes("thinking") &&
    (message.includes("first block") || message.includes("must start with") || message.includes("preceeding"))
  ) {
    return "thinking_block_order"
  }

  if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
    return "thinking_disabled_violation"
  }

  if (message.includes("non-empty content") || message.includes("must have non-empty content")) {
    return "empty_content_message"
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
  const parts = failedAssistantMsg.parts || []
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
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  directory: string
): Promise<boolean> {
  const messageID = failedAssistantMsg.info?.id
  if (!messageID) {
    return false
  }

  const existingParts = failedAssistantMsg.parts || []
  const patchedParts: MessagePart[] = [{ type: "thinking", thinking: "" } as ThinkingPart, ...existingParts]

  try {
    // @ts-expect-error - Experimental API
    await client.message?.update?.({
      path: { id: messageID },
      body: { parts: patchedParts },
    })
    return true
  } catch {}

  try {
    // @ts-expect-error - Experimental API
    await client.session.patch?.({
      path: { id: sessionID },
      body: { messageID, parts: patchedParts },
    })
    return true
  } catch {}

  return await fallbackRevertStrategy(client, sessionID, failedAssistantMsg, directory)
}

async function recoverThinkingDisabledViolation(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData
): Promise<boolean> {
  const messageID = failedAssistantMsg.info?.id
  if (!messageID) {
    return false
  }

  const existingParts = failedAssistantMsg.parts || []
  const strippedParts = existingParts.filter((p) => p.type !== "thinking" && p.type !== "redacted_thinking")

  if (strippedParts.length === 0) {
    return false
  }

  try {
    // @ts-expect-error - Experimental API
    await client.message?.update?.({
      path: { id: messageID },
      body: { parts: strippedParts },
    })
    return true
  } catch {}

  try {
    // @ts-expect-error - Experimental API
    await client.session.patch?.({
      path: { id: sessionID },
      body: { messageID, parts: strippedParts },
    })
    return true
  } catch {}

  return false
}

async function recoverEmptyContentMessage(
  _client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  _directory: string
): Promise<boolean> {
  const emptyMessageID = findFirstEmptyMessage(sessionID) || failedAssistantMsg.info?.id
  if (!emptyMessageID) return false

  return injectTextPart(sessionID, emptyMessageID, "(interrupted)")
}

async function fallbackRevertStrategy(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  directory: string
): Promise<boolean> {
  const parentMsgID = failedAssistantMsg.info?.parentID

  const messagesResp = await client.session.messages({
    path: { id: sessionID },
    query: { directory },
  })
  const msgs = (messagesResp as { data?: MessageData[] }).data
  if (!msgs || msgs.length === 0) {
    return false
  }

  let targetUserMsg: MessageData | null = null
  if (parentMsgID) {
    targetUserMsg = msgs.find((m) => m.info?.id === parentMsgID) ?? null
  }
  if (!targetUserMsg) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].info?.role === "user") {
        targetUserMsg = msgs[i]
        break
      }
    }
  }

  if (!targetUserMsg?.parts?.length) {
    return false
  }

  await client.session.revert({
    path: { id: sessionID },
    body: { messageID: targetUserMsg.info?.id ?? "" },
    query: { directory },
  })

  const textParts = targetUserMsg.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => ({ type: "text" as const, text: p.text ?? "" }))

  if (textParts.length === 0) {
    return false
  }

  await client.session.prompt({
    path: { id: sessionID },
    body: { parts: textParts },
    query: { directory },
  })

  return true
}

export function createSessionRecoveryHook(ctx: PluginInput) {
  const processingErrors = new Set<string>()
  let onAbortCallback: ((sessionID: string) => void) | null = null

  const setOnAbortCallback = (callback: (sessionID: string) => void): void => {
    onAbortCallback = callback
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
      await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})

      if (onAbortCallback) {
        onAbortCallback(sessionID)
      }

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
        empty_content_message: "Empty Message Recovery",
      }
      const toastMessages: Record<RecoveryErrorType & string, string> = {
        tool_result_missing: "Injecting cancelled tool results...",
        thinking_block_order: "Fixing message structure...",
        thinking_disabled_violation: "Stripping thinking blocks...",
        empty_content_message: "Fixing empty message...",
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
        success = await recoverThinkingBlockOrder(ctx.client, sessionID, failedMsg, ctx.directory)
      } else if (errorType === "thinking_disabled_violation") {
        success = await recoverThinkingDisabledViolation(ctx.client, sessionID, failedMsg)
      } else if (errorType === "empty_content_message") {
        success = await recoverEmptyContentMessage(ctx.client, sessionID, failedMsg, ctx.directory)
      }

      return success
    } catch {
      return false
    } finally {
      processingErrors.delete(assistantMsgID)
    }
  }

  return {
    handleSessionRecovery,
    isRecoverableError,
    setOnAbortCallback,
  }
}
