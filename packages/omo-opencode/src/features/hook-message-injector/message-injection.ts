import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { PART_STORAGE } from "./constants"
import { generateMessageId, generatePartId } from "./id-generation"
import { findNearestMessageWithFields } from "./json-message-lookup"
import { getOrCreateMessageDir } from "./message-directory"
import type { MessageMeta, OriginalMessageContext, StoredMessage, TextPart } from "./types"

function resolveModel(originalMessage: OriginalMessageContext, fallback: StoredMessage | null): MessageMeta["model"] {
  if (originalMessage.model?.providerID && originalMessage.model?.modelID) {
    return {
      providerID: originalMessage.model.providerID,
      modelID: originalMessage.model.modelID,
      ...(originalMessage.model.variant ? { variant: originalMessage.model.variant } : {}),
    }
  }

  if (fallback?.model?.providerID && fallback.model?.modelID) {
    return {
      providerID: fallback.model.providerID,
      modelID: fallback.model.modelID,
      ...(fallback.model.variant ? { variant: fallback.model.variant } : {}),
    }
  }

  return undefined
}

function removeInjectionArtifact(path: string, sessionID: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[hook-message-injector] Failed to clean up partial injection artifact", {
      sessionID,
      path,
      error: errorMessage,
    })
  }
}

export function injectHookMessage(
  sessionID: string,
  hookContent: string,
  originalMessage: OriginalMessageContext
): boolean {
  if (!hookContent || hookContent.trim().length === 0) {
    log("[hook-message-injector] Attempted to inject empty hook content, skipping injection", {
      sessionID,
      hasAgent: !!originalMessage.agent,
      hasModel: !!(originalMessage.model?.providerID && originalMessage.model?.modelID)
    })
    return false
  }

  if (isSqliteBackend()) {
    log("[hook-message-injector] Skipping JSON message injection on SQLite backend. " +
        "In-flight injection is handled via experimental.chat.messages.transform hook. " +
        "JSON write path is not needed when SQLite is the storage backend.", {
      sessionID,
      agent: originalMessage.agent,
    })
    return false
  }

  const messageDir = getOrCreateMessageDir(sessionID)
  if (!messageDir) {
    return false
  }
  const needsFallback =
    !originalMessage.agent ||
    !originalMessage.model?.providerID ||
    !originalMessage.model?.modelID
  const fallback = needsFallback ? findNearestMessageWithFields(messageDir) : null
  const now = Date.now()
  const messageID = generateMessageId()
  const partID = generatePartId()

  const messageMeta: MessageMeta = {
    id: messageID,
    sessionID,
    role: "user",
    time: {
      created: now,
    },
    agent: originalMessage.agent ?? fallback?.agent ?? "general",
    model: resolveModel(originalMessage, fallback),
    path:
      originalMessage.path?.cwd
        ? {
            cwd: originalMessage.path.cwd,
            root: originalMessage.path.root ?? "/",
          }
        : undefined,
    tools: originalMessage.tools ?? fallback?.tools,
  }

  const textPart: TextPart = {
    id: partID,
    type: "text",
    text: createInternalAgentTextPart(hookContent).text,
    synthetic: true,
    time: {
      start: now,
      end: now,
    },
    messageID,
    sessionID,
  }

  try {
    const partDir = join(PART_STORAGE, messageID)
    if (!existsSync(partDir)) {
      mkdirSync(partDir, { recursive: true })
    }

    const messagePath = join(messageDir, `${messageID}.json`)
    const partPath = join(partDir, `${partID}.json`)
    writeFileSync(partPath, JSON.stringify(textPart, null, 2))
    writeFileSync(messagePath, JSON.stringify(messageMeta, null, 2))

    return true
  } catch (error) {
    if (error instanceof Error) {
      removeInjectionArtifact(join(messageDir, `${messageID}.json`), sessionID)
      removeInjectionArtifact(join(PART_STORAGE, messageID), sessionID)
      return false
    }
    removeInjectionArtifact(join(messageDir, `${messageID}.json`), sessionID)
    removeInjectionArtifact(join(PART_STORAGE, messageID), sessionID)
    return false
  }
}
