import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { MESSAGE_STORAGE, PART_STORAGE } from "./constants"
import type { MessageMeta, OriginalMessageContext, TextPart, ToolPermission } from "./types"
import { log } from "../../shared/logger"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { normalizeSDKResponse } from "../../shared"

export interface StoredMessage {
  agent?: string
  model?: { providerID?: string; modelID?: string; variant?: string }
  tools?: Record<string, ToolPermission>
}

type OpencodeClient = PluginInput["client"]

interface SDKMessage {
  info?: {
    agent?: string
    model?: {
      providerID?: string
      modelID?: string
      variant?: string
    }
    providerID?: string
    modelID?: string
    tools?: Record<string, ToolPermission>
  }
}

function convertSDKMessageToStoredMessage(msg: SDKMessage): StoredMessage | null {
  const info = msg.info
  if (!info) return null

  const providerID = info.model?.providerID ?? info.providerID
  const modelID = info.model?.modelID ?? info.modelID
  const variant = info.model?.variant

  if (!info.agent && !providerID && !modelID) {
    return null
  }

  return {
    agent: info.agent,
    model: providerID && modelID
      ? { providerID, modelID, ...(variant ? { variant } : {}) }
      : undefined,
    tools: info.tools,
  }
}

// TODO: These SDK-based functions are exported for future use when hooks migrate to async.
// Currently, callers still use the sync JSON-based functions which return null on beta.
// Migration requires making callers async, which is a larger refactoring.
// See: https://github.com/code-yeongyu/oh-my-opencode/pull/1837

/**
 * Finds the nearest message with required fields using SDK (for beta/SQLite backend).
 * Uses client.session.messages() to fetch message data from SQLite.
 */
export async function findNearestMessageWithFieldsFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<StoredMessage | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })

    for (let i = messages.length - 1; i >= 0; i--) {
      const stored = convertSDKMessageToStoredMessage(messages[i])
      if (stored?.agent && stored.model?.providerID && stored.model?.modelID) {
        return stored
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const stored = convertSDKMessageToStoredMessage(messages[i])
      if (stored?.agent || (stored?.model?.providerID && stored?.model?.modelID)) {
        return stored
      }
    }
  } catch (error) {
    log("[hook-message-injector] SDK message fetch failed", {
      sessionID,
      error: String(error),
    })
  }
  return null
}

/**
 * Finds the FIRST (oldest) message with agent field using SDK (for beta/SQLite backend).
 */
export async function findFirstMessageWithAgentFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<string | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })

    for (const msg of messages) {
      const stored = convertSDKMessageToStoredMessage(msg)
      if (stored?.agent) {
        return stored.agent
      }
    }
  } catch (error) {
    log("[hook-message-injector] SDK agent fetch failed", {
      sessionID,
      error: String(error),
    })
  }
  return null
}

/**
 * Finds the nearest message with required fields (agent, model.providerID, model.modelID).
 * Reads from JSON files - for stable (JSON) backend.
 *
 * **Version-gated behavior:**
 * - On beta (SQLite backend): Returns null immediately (no JSON storage)
 * - On stable (JSON backend): Reads from JSON files in messageDir
 *
 * @deprecated Use findNearestMessageWithFieldsFromSDK for beta/SQLite backend
 */
export function findNearestMessageWithFields(messageDir: string): StoredMessage | null {
  // On beta SQLite backend, skip JSON file reads entirely
  if (isSqliteBackend()) {
    return null
  }

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

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        const msg = JSON.parse(content) as StoredMessage
        if (msg.agent || (msg.model?.providerID && msg.model?.modelID)) {
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

/**
 * Finds the FIRST (oldest) message in the session with agent field.
 * Reads from JSON files - for stable (JSON) backend.
 *
 * **Version-gated behavior:**
 * - On beta (SQLite backend): Returns null immediately (no JSON storage)
 * - On stable (JSON backend): Reads from JSON files in messageDir
 *
 * @deprecated Use findFirstMessageWithAgentFromSDK for beta/SQLite backend
 */
export function findFirstMessageWithAgent(messageDir: string): string | null {
  // On beta SQLite backend, skip JSON file reads entirely
  if (isSqliteBackend()) {
    return null
  }

  try {
    const files = readdirSync(messageDir)
      .filter((f) => f.endsWith(".json"))
      .sort()

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        const msg = JSON.parse(content) as StoredMessage
        if (msg.agent) {
          return msg.agent
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

/**
 * Injects a hook message into the session storage.
 *
 * **Version-gated behavior:**
 * - On beta (SQLite backend): Logs warning and skips injection (writes are invisible to SQLite)
 * - On stable (JSON backend): Writes message and part JSON files
 *
 * Features degraded on beta:
 * - Hook message injection (e.g., continuation prompts, context injection) won't persist
 * - Atlas hook's injected messages won't be visible in SQLite backend
 * - Todo continuation enforcer's injected prompts won't persist
 * - Ralph loop's continuation prompts won't persist
 *
 * @param sessionID - Target session ID
 * @param hookContent - Content to inject
 * @param originalMessage - Context from the original message
 * @returns true if injection succeeded, false otherwise
 */
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
      ? { 
          providerID: originalMessage.model.providerID, 
          modelID: originalMessage.model.modelID,
          ...(originalMessage.model.variant ? { variant: originalMessage.model.variant } : {})
        }
      : fallback?.model?.providerID && fallback?.model?.modelID
        ? { 
            providerID: fallback.model.providerID, 
            modelID: fallback.model.modelID,
            ...(fallback.model.variant ? { variant: fallback.model.variant } : {})
          }
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

export async function resolveMessageContext(
  sessionID: string,
  client: OpencodeClient,
  messageDir: string | null
): Promise<{ prevMessage: StoredMessage | null; firstMessageAgent: string | null }> {
  const [prevMessage, firstMessageAgent] = isSqliteBackend()
    ? await Promise.all([
        findNearestMessageWithFieldsFromSDK(client, sessionID),
        findFirstMessageWithAgentFromSDK(client, sessionID),
      ])
    : [
        messageDir ? findNearestMessageWithFields(messageDir) : null,
        messageDir ? findFirstMessageWithAgent(messageDir) : null,
      ]

  return { prevMessage, firstMessageAgent }
}
