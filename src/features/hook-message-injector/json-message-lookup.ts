import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { hasCompactionPartInStorage, isCompactionMessage } from "../../shared/compaction-marker"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { isRecord } from "../../shared/record-type-guard"
import type { StoredMessage, ToolPermission } from "./types"

type StoredMessageWithTime = StoredMessage & {
  id?: string
  time?: { created?: number }
}

type MessageEntry = {
  readonly fileName: string
  readonly msg: StoredMessageWithTime
  readonly hasCompactionMarker: boolean
  readonly createdAt: number
}

function parseToolPermission(value: unknown): ToolPermission | null {
  if (typeof value === "boolean") {
    return value
  }

  if (value === "allow" || value === "deny" || value === "ask") {
    return value
  }

  return null
}

function parseTools(value: unknown): Record<string, ToolPermission> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const tools: Record<string, ToolPermission> = {}
  for (const [key, rawPermission] of Object.entries(value)) {
    const permission = parseToolPermission(rawPermission)
    if (permission !== null) {
      tools[key] = permission
    }
  }

  return tools
}

function parseModel(value: unknown): StoredMessageWithTime["model"] {
  if (!isRecord(value)) {
    return undefined
  }

  const providerID = typeof value.providerID === "string" ? value.providerID : undefined
  const modelID = typeof value.modelID === "string" ? value.modelID : undefined
  const variant = typeof value.variant === "string" ? value.variant : undefined

  return providerID || modelID || variant
    ? { providerID, modelID, ...(variant ? { variant } : {}) }
    : undefined
}

function parseCreatedAt(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  return typeof value.created === "number" ? value.created : undefined
}

function parseStoredMessageWithTime(value: unknown): StoredMessageWithTime | null {
  if (!isRecord(value)) {
    return null
  }

  const created = parseCreatedAt(value.time)
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    agent: typeof value.agent === "string" ? value.agent : undefined,
    model: parseModel(value.model),
    tools: parseTools(value.tools),
    time: created === undefined ? undefined : { created },
  }
}

function readMessageEntry(fileName: string, messageDir: string, missingCreatedAt: number): MessageEntry | null {
  try {
    const content = readFileSync(join(messageDir, fileName), "utf-8")
    const msg = parseStoredMessageWithTime(JSON.parse(content))
    if (!msg) {
      return null
    }

    return {
      fileName,
      msg,
      hasCompactionMarker: hasCompactionPartInStorage(msg.id),
      createdAt: typeof msg.time?.created === "number" ? msg.time.created : missingCreatedAt,
    }
  } catch (error) {
    if (error instanceof Error) {
      return null
    }

    throw error
  }
}

function getMessageEntries(messageDir: string, missingCreatedAt: number): MessageEntry[] {
  return readdirSync(messageDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => readMessageEntry(fileName, messageDir, missingCreatedAt))
    .filter((entry): entry is MessageEntry => entry !== null)
}

function isUsableMessageEntry(entry: MessageEntry): boolean {
  return !entry.hasCompactionMarker && !isCompactionMessage({ agent: entry.msg.agent })
}

export function findNearestMessageWithFields(messageDir: string): StoredMessage | null {
  if (isSqliteBackend()) {
    return null
  }

  try {
    const messages = getMessageEntries(messageDir, Number.NEGATIVE_INFINITY)
      .sort((left, right) => right.createdAt - left.createdAt || right.fileName.localeCompare(left.fileName))

    for (const entry of messages) {
      if (!isUsableMessageEntry(entry)) {
        continue
      }

      if (entry.msg.agent && entry.msg.model?.providerID && entry.msg.model?.modelID) {
        return entry.msg
      }
    }

    for (const entry of messages) {
      if (!isUsableMessageEntry(entry)) {
        continue
      }

      if (entry.msg.agent || (entry.msg.model?.providerID && entry.msg.model?.modelID)) {
        return entry.msg
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      return null
    }

    throw error
  }
  return null
}

export function findFirstMessageWithAgent(messageDir: string): string | null {
  if (isSqliteBackend()) {
    return null
  }

  try {
    const messages = getMessageEntries(messageDir, Number.POSITIVE_INFINITY)
      .sort((left, right) => left.createdAt - right.createdAt || left.fileName.localeCompare(right.fileName))

    for (const entry of messages) {
      if (!isUsableMessageEntry(entry)) {
        continue
      }

      if (entry.msg.agent) {
        return entry.msg.agent
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      return null
    }

    throw error
  }
  return null
}
