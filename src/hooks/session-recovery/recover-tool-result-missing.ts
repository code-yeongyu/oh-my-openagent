import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData } from "./types"
import { readParts } from "./storage"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { normalizeSDKResponse } from "../../shared"

type Client = ReturnType<typeof createOpencodeClient>

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

    return target.parts.map((part) => ({
      type: part.type === "tool" ? "tool_use" : part.type,
      id: "callID" in part ? (part as { callID?: string }).callID : part.id,
    }))
  } catch {
    return []
  }
}

export async function recoverToolResultMissing(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData
): Promise<boolean> {
  let parts = failedAssistantMsg.parts || []
  if (parts.length === 0 && failedAssistantMsg.info?.id) {
    if (isSqliteBackend()) {
      parts = await readPartsFromSDKFallback(client, sessionID, failedAssistantMsg.info.id)
    } else {
      const storedParts = readParts(failedAssistantMsg.info.id)
      parts = storedParts.map((part) => ({
        type: part.type === "tool" ? "tool_use" : part.type,
        id: "callID" in part ? (part as { callID?: string }).callID : part.id,
      }))
    }
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

  const promptInput = {
    path: { id: sessionID },
    body: { parts: toolResultParts },
  }

  try {
    // @ts-expect-error - SDK types may not include tool_result parts
    await client.session.promptAsync(promptInput)

    return true
  } catch {
    return false
  }
}
