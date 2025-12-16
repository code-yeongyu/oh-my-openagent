import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE } from "./constants"
import type { MessageMeta, OriginalMessageContext, TextPart } from "./types"

export interface StoredMessage {
  agent?: string
  model?: { providerID?: string; modelID?: string }
  tools?: Record<string, boolean>
}

export function findNearestMessageWithFields(messageDir: string): StoredMessage | null {
  try {
    const files = readdirSync(messageDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        const msg = JSON.parse(content) as StoredMessage
        if (msg.agent && msg.model?.providerID && msg.model?.modelID) {
          return msg
        }
      } catch {
        continue
      }
    }
  } catch {
    return null
  }
  return null
}

function generateMessageId(): string {
  const timestamp = Date.now().toString(16)
  const random = Math.random().toString(36).substring(2, 14)
  return `msg_${timestamp}${random}`
}

function generatePartId(): string {
  const timestamp = Date.now().toString(16)
  const random = Math.random().toString(36).substring(2, 10)
  return `prt_${timestamp}${random}`
}

function getOrCreateMessageDir(sessionID: string): string {
  if (!existsSync(MESSAGE_STORAGE)) {
    mkdirSync(MESSAGE_STORAGE, { recursive: true })
  }

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) {
      return sessionPath
    }
  }

  mkdirSync(directPath, { recursive: true })
  return directPath
}

export function injectHookMessage(
  sessionID: string,
  hookContent: string,
  originalMessage: OriginalMessageContext
): boolean {
  // Validate hook content to prevent empty message injection
  if (!hookContent || hookContent.trim().length === 0) {
    console.warn("[hook-message-injector] Attempted to inject empty hook content, skipping injection", {
      sessionID,
      hasAgent: !!originalMessage.agent,
      hasModel: !!(originalMessage.model?.providerID && originalMessage.model?.modelID)
    })
    return false
  }

  const messageDir = getOrCreateMessageDir(sessionID)

  const needsFallback =
    !originalMessage.agent ||
    !originalMessage.model?.providerID ||
    !originalMessage.model?.modelID

  const fallback = needsFallback ? findNearestMessageWithFields(messageDir) : null

  const now = Date.now()
  const messageID = generateMessageId()
  const partID = generatePartId()

  const resolvedAgent = originalMessage.agent ?? fallback?.agent ?? "general"
  const resolvedModel =
    originalMessage.model?.providerID && originalMessage.model?.modelID
      ? { providerID: originalMessage.model.providerID, modelID: originalMessage.model.modelID }
      : fallback?.model?.providerID && fallback?.model?.modelID
        ? { providerID: fallback.model.providerID, modelID: fallback.model.modelID }
        : undefined
  const resolvedTools = originalMessage.tools ?? fallback?.tools

  const messageMeta: MessageMeta = {
    id: messageID,
    sessionID,
    role: "user",
    time: {
      created: now,
    },
    agent: resolvedAgent,
    model: resolvedModel,
    path:
      originalMessage.path?.cwd
        ? {
            cwd: originalMessage.path.cwd,
            root: originalMessage.path.root ?? "/",
          }
        : undefined,
    tools: resolvedTools,
  }

  const textPart: TextPart = {
    id: partID,
    type: "text",
    text: hookContent,
    synthetic: true,
    time: {
      start: now,
      end: now,
    },
    messageID,
    sessionID,
  }

  try {
    writeFileSync(join(messageDir, `${messageID}.json`), JSON.stringify(messageMeta, null, 2))

    const partDir = join(PART_STORAGE, messageID)
    if (!existsSync(partDir)) {
      mkdirSync(partDir, { recursive: true })
    }
    writeFileSync(join(partDir, `${partID}.json`), JSON.stringify(textPart, null, 2))

    return true
  } catch {
    return false
  }
}
