import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData } from "./types"
import { readParts } from "./storage"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { normalizeSDKResponse } from "../../shared"
import { extractMessageIndex } from "./detect-error-type"

type Client = ReturnType<typeof createOpencodeClient>
type ClientWithPromptAsync = {
  session: {
    promptAsync: (opts: { path: { id: string }; body: Record<string, unknown> }) => Promise<unknown>
  }
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
}

function extractToolUseIds(parts: MessagePart[]): string[] {
  return parts.filter((part): part is ToolUsePart => part.type === "tool_use" && !!part.id).map((part) => part.id)
}

function mapStoredPartsToMessageParts(parts: Array<{ type: string; callID?: string; id?: string }>): MessagePart[] {
  return parts.map((part) => ({
    type: part.type === "tool" ? "tool_use" : part.type,
    id: "callID" in part ? (part as { callID?: string }).callID : part.id,
  }))
}

async function readPartsFromSDKFallback(
  client: Client,
  sessionID: string,
  messageID: string
): Promise<MessagePart[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
    const target = messages.find((m) => m.info?.id === messageID)
    if (!target?.parts) return []

    return mapStoredPartsToMessageParts(target.parts)
  } catch {
    return []
  }
}

async function resolvePartsForMessage(
  client: Client,
  sessionID: string,
  msg: MessageData
): Promise<MessagePart[]> {
  const parts = msg.parts || []
  if (parts.length > 0) {
    return mapStoredPartsToMessageParts(parts)
  }

  if (!msg.info?.id) return []

  if (isSqliteBackend()) {
    return readPartsFromSDKFallback(client, sessionID, msg.info.id)
  }

  const storedParts = readParts(msg.info.id)
  return mapStoredPartsToMessageParts(storedParts)
}

export function findBrokenMessageByIndex(
  allMessages: MessageData[],
  error: unknown
): MessageData | null {
  const errorIndex = extractMessageIndex(error)
  if (errorIndex === null) return null

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i]
    if (msg.info?.role === "assistant" && !msg.info?.error) {
      const parts = msg.parts || []
      const hasToolParts = parts.some(
        (p) => p.type === "tool" || p.type === "tool_use"
      )
      if (hasToolParts) return msg
    }
  }

  return null
}

export async function recoverToolResultMissing(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  allMessages: MessageData[] = [],
  error?: unknown
): Promise<boolean> {
  let toolUseIds: string[] = []

  if (allMessages.length > 0 && error) {
    const brokenMsg = findBrokenMessageByIndex(allMessages, error)
    if (brokenMsg) {
      const parts = await resolvePartsForMessage(client, sessionID, brokenMsg)
      toolUseIds = extractToolUseIds(parts)
    }
  }

  if (toolUseIds.length === 0) {
    const parts = await resolvePartsForMessage(client, sessionID, failedAssistantMsg)
    toolUseIds = extractToolUseIds(parts)
  }

  if (toolUseIds.length === 0) {
    return false
  }

  const toolResultParts = toolUseIds.map((id) => ({
    type: "tool_result" as const,
    tool_use_id: id,
    content: "Operation cancelled by user (ESC pressed)",
  }))

  const promptInput = {
    path: { id: sessionID },
    body: { parts: toolResultParts },
  }

  try {
    await (client as unknown as ClientWithPromptAsync).session.promptAsync(promptInput)

    return true
  } catch {
    return false
  }
}
