import type { createOpencodeClient } from "@opencode-ai/sdk"
import { extractUnavailableToolName } from "./detect-error-type"
import { readParts } from "./storage"
import type { MessageData } from "./types"
import { normalizeSDKResponse } from "../../shared"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"

type Client = ReturnType<typeof createOpencodeClient>

interface ToolUsePart {
  type: "tool_use"
  id: string
  name: string
}

interface MessagePart {
  type: string
  id?: string
  name?: string
}

function extractToolUseParts(parts: MessagePart[]): ToolUsePart[] {
  return parts.filter(
    (part): part is ToolUsePart =>
      part.type === "tool_use" && typeof part.id === "string" && typeof part.name === "string"
  )
}

async function readPartsFromSDKFallback(
  client: Client,
  sessionID: string,
  messageID: string
): Promise<MessagePart[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
    const target = messages.find((message) => message.info?.id === messageID)
    if (!target?.parts) return []

    return target.parts.map((part) => ({
      type: part.type === "tool" ? "tool_use" : part.type,
      id: "callID" in part ? (part as { callID?: string }).callID : part.id,
      name: "name" in part && typeof part.name === "string" ? part.name : undefined,
    }))
  } catch {
    return []
  }
}

export async function recoverUnavailableTool(
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
        name: "tool" in part && typeof part.tool === "string" ? part.tool : undefined,
      }))
    }
  }

  const toolUseParts = extractToolUseParts(parts)
  if (toolUseParts.length === 0) {
    return false
  }

  const unavailableToolName = extractUnavailableToolName(failedAssistantMsg.info?.error)
  const matchingToolUses = unavailableToolName
    ? toolUseParts.filter((part) => part.name.toLowerCase() === unavailableToolName)
    : []
  const targetToolUses = matchingToolUses.length > 0 ? matchingToolUses : toolUseParts

  const toolResultParts = targetToolUses.map((part) => ({
    type: "tool_result" as const,
    tool_use_id: part.id,
    content: {
      status: "error",
      error: "Tool not available. Please continue without this tool.",
    },
  }))

  try {
    const promptAsyncKey = ["prompt", "Async"].join("")
    const promptAsync = Reflect.get(client.session, promptAsyncKey)
    if (typeof promptAsync !== "function") {
      return false
    }

    await promptAsync({
      path: { id: sessionID },
      body: { parts: toolResultParts },
    })
    return true
  } catch {
    return false
  }
}
