import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData, ResumeConfig } from "./types"
import { readParts } from "./storage/parts-reader"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { normalizeSDKResponse } from "../../shared"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"

type Client = ReturnType<typeof createOpencodeClient>
type ToolResultContent = { type: "text"; text: string }
type ToolResultPart = {
  type: "tool_result"
  toolUseId: string
  tool_use_id?: string
  isError?: boolean
  content: ToolResultContent[]
}
type ClientWithPromptAsync = {
  session: {
    promptAsync: (opts: { path: { id: string }; body: Record<string, unknown> }) => Promise<unknown>
    status?: () => Promise<unknown>
  }
}

export type RecoverToolResultMissingOptions = {
  recoverStatuses?: ReadonlySet<string>
  resultText?: string
  source?: string
}

function hasPromptAsync(client: Client): client is Client & ClientWithPromptAsync {
  return "promptAsync" in client.session && typeof client.session.promptAsync === "function"
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
  state?: {
    status?: unknown
  }
}

function isValidToolUseID(id: string | undefined): id is string {
  return typeof id === "string" && /^(toolu_|call_)/.test(id)
}

function normalizeMessagePart(part: { type: string; id?: string; callID?: string; state?: { status?: unknown } }): MessagePart | null {
  if (part.type === "tool" || part.type === "tool_use") {
    const toolUseID = part.callID ?? part.id
    if (!isValidToolUseID(toolUseID)) {
      return null
    }

    return {
      type: "tool_use",
      id: toolUseID,
      state: part.state,
    }
  }

  return {
    type: part.type,
    id: part.id,
  }
}

function shouldRecoverToolUsePart(part: MessagePart, recoverStatuses: ReadonlySet<string> | undefined): boolean {
  if (part.type !== "tool_use" || !isValidToolUseID(part.id)) {
    return false
  }
  if (!recoverStatuses) {
    return true
  }
  const status = part.state?.status
  return typeof status === "string" && recoverStatuses.has(status)
}

function extractToolUseIds(parts: MessagePart[], recoverStatuses?: ReadonlySet<string>): string[] {
  return parts
    .filter((part): part is ToolUsePart => shouldRecoverToolUsePart(part, recoverStatuses))
    .map((part) => part.id)
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

    return target.parts.map((part) => normalizeMessagePart(part)).filter((part): part is MessagePart => part !== null)
  } catch {
    return []
  }
}

export async function recoverToolResultMissing(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  resumeConfig?: ResumeConfig,
  options?: RecoverToolResultMissingOptions,
): Promise<boolean> {
  let parts = (failedAssistantMsg.parts || [])
    .map((part) => normalizeMessagePart(part))
    .filter((part): part is MessagePart => part !== null)
  if (parts.length === 0 && failedAssistantMsg.info?.id) {
    if (isSqliteBackend()) {
      parts = await readPartsFromSDKFallback(client, sessionID, failedAssistantMsg.info.id)
    } else {
      const storedParts = readParts(failedAssistantMsg.info.id)
      parts = storedParts.map((part) => normalizeMessagePart(part)).filter((part): part is MessagePart => part !== null)
    }
  }

  const toolUseIds = extractToolUseIds(parts, options?.recoverStatuses)
  if (toolUseIds.length === 0) {
    return false
  }
  const resultText = options?.resultText ?? "Operation cancelled by user (ESC pressed)"

  const toolResultParts = toolUseIds.map((id) => ({
    type: "tool_result" as const,
    toolUseId: id,
    tool_use_id: id,
    isError: true,
    content: [{ type: "text" as const, text: resultText }],
  }))

  const launchAgent = resumeConfig?.agent
  const launchModel = resumeConfig?.model
    ? { providerID: resumeConfig.model.providerID, modelID: resumeConfig.model.modelID }
    : undefined
  const launchVariant = resumeConfig?.model?.variant

  const promptInput = {
    path: { id: sessionID },
    body: {
      parts: toolResultParts,
      ...(launchAgent ? { agent: launchAgent } : {}),
      ...(launchModel ? { model: launchModel } : {}),
      ...(launchVariant ? { variant: launchVariant } : {}),
    },
  }

  try {
    if (!hasPromptAsync(client)) {
      return false
    }

    const promptResult = await promptAsyncAfterSessionIdle({
      client,
      sessionID,
      source: options?.source ?? "session-recovery-tool-result-missing",
      input: promptInput,
    })

    return promptResult.status === "dispatched"
  } catch {
    return false
  }
}
