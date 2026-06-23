import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { PART_STORAGE, THINKING_TYPES } from "../constants"
import type { MessageData, StoredPart } from "../types"
import { readMessages } from "./messages-reader"
import { readParts } from "./parts-reader"
import { log, isSqliteBackend, patchPart } from "../../../shared"
import { normalizeSDKResponse } from "../../../shared"

type OpencodeClient = PluginInput["client"]
type StoredSignedThinkingPart = StoredPart & {
  type: "thinking" | "redacted_thinking"
  signature: string
}
type SDKMessagePart = NonNullable<MessageData["parts"]>[number]
type SDKSignedThinkingPart = SDKMessagePart & {
  id: string
  type: "thinking" | "redacted_thinking"
  signature: string
}

type ThinkingPrependDeps = {
  isSqliteBackend: typeof isSqliteBackend
  patchPart: typeof patchPart
  log: typeof log
  findLastThinkingPart: typeof findLastThinkingPart
  findLastThinkingPartFromSDK: typeof findLastThinkingPartFromSDK
  readTargetPartIDs: typeof readTargetPartIDs
  readTargetPartIDsFromSDK: typeof readTargetPartIDsFromSDK
}

const thinkingPrependDeps: ThinkingPrependDeps = {
  isSqliteBackend,
  patchPart,
  log,
  findLastThinkingPart,
  findLastThinkingPartFromSDK,
  readTargetPartIDs,
  readTargetPartIDsFromSDK,
}

function readTargetPartIDs(messageID: string): string[] {
  return readParts(messageID)
    .map((part) => part.id)
    .filter((id): id is string => typeof id === "string")
}

async function readTargetPartIDsFromSDK(
  client: OpencodeClient,
  sessionID: string,
  messageID: string
): Promise<string[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
    const targetMessage = messages.find((message) => message.info?.id === messageID)
    if (!targetMessage?.parts) {
      return []
    }

    return targetMessage.parts
      .map((part) => part.id)
      .filter((id): id is string => typeof id === "string")
  } catch {
    return []
  }
}

function canPrependBeforeTargetParts(partID: string, targetPartIDs: string[]): boolean {
  const firstTargetPartID = [...targetPartIDs].sort((left, right) => left.localeCompare(right))[0]
  return !firstTargetPartID || partID.localeCompare(firstTargetPartID) < 0
}

function isStoredSignedThinkingPart(part: StoredPart): part is StoredSignedThinkingPart {
  if (!THINKING_TYPES.has(part.type)) {
    return false
  }

  if (part.type === "reasoning") {
    return false
  }

  const signature = Reflect.get(part, "signature")
  return typeof signature === "string" && signature.length > 0
}

function isSDKSignedThinkingPart(part: SDKMessagePart): part is SDKSignedThinkingPart {
  if (!part.type || !THINKING_TYPES.has(part.type)) {
    return false
  }

  if (part.type === "reasoning") {
    return false
  }

  return typeof part.id === "string"
    && typeof (part as { signature?: unknown }).signature === "string"
    && ((part as { signature?: string }).signature?.length ?? 0) > 0
}

function toPatchBody(part: SDKSignedThinkingPart): Record<string, unknown> {
  return { ...part }
}

function findLastThinkingPart(
  sessionID: string,
  beforeMessageID: string
): StoredSignedThinkingPart | null {
  const messages = readMessages(sessionID)

  const currentIndex = messages.findIndex((message) => message.id === beforeMessageID)
  if (currentIndex === -1) return null

  for (let i = currentIndex - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") continue

    const parts = readParts(message.id)
    for (const part of parts) {
      if (isStoredSignedThinkingPart(part)) {
        return part
      }
    }
  }

  return null
}

export function prependThinkingPart(
  sessionID: string,
  messageID: string,
  deps: ThinkingPrependDeps = thinkingPrependDeps
): boolean {
  if (deps.isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: prependThinkingPart (use async variant)")
    return false
  }

  const previousThinkingPart = deps.findLastThinkingPart(sessionID, messageID)
  if (!previousThinkingPart) {
    return false
  }

  if (!canPrependBeforeTargetParts(previousThinkingPart.id, deps.readTargetPartIDs(messageID))) {
    return false
  }

  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  try {
    writeFileSync(
      join(partDir, `${previousThinkingPart.id}.json`),
      JSON.stringify(previousThinkingPart, null, 2)
    )
    return true
  } catch {
    return false
  }
}

async function findLastThinkingPartFromSDK(
  client: OpencodeClient,
  sessionID: string,
  beforeMessageID: string
): Promise<SDKSignedThinkingPart | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })

    const currentIndex = messages.findIndex((m) => m.info?.id === beforeMessageID)
    if (currentIndex === -1) return null

    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info?.role !== "assistant") continue
      if (!msg.parts) continue

      for (const part of msg.parts) {
        if (isSDKSignedThinkingPart(part)) {
          return part
        }
      }
    }
  } catch {
    return null
  }
  return null
}

export async function prependThinkingPartAsync(
  client: OpencodeClient,
  sessionID: string,
  messageID: string,
  deps: ThinkingPrependDeps = thinkingPrependDeps
): Promise<boolean> {
  const previousThinkingPart = await deps.findLastThinkingPartFromSDK(client, sessionID, messageID)
  if (!previousThinkingPart) {
    return false
  }

  const targetPartIDs = await deps.readTargetPartIDsFromSDK(client, sessionID, messageID)
  if (!canPrependBeforeTargetParts(previousThinkingPart.id, targetPartIDs)) {
    return false
  }

  try {
    return await deps.patchPart(
      client,
      sessionID,
      messageID,
      previousThinkingPart.id,
      toPatchBody(previousThinkingPart)
    )
  } catch (error) {
    deps.log("[session-recovery] prependThinkingPartAsync failed", { error: String(error) })
    return false
  }
}
