import type { Message, Part, Session } from "@opencode-ai/sdk"
import { isRecord } from "@oh-my-opencode/utils"

import type { PluginContext } from "../../plugin/types"
import { log, normalizeSDKResponse } from "../../shared"
import {
  getBtwSideMetadata,
  type BtwSideMetadata,
} from "./metadata"
import { boundBtwParentContext } from "./parent-context-budget"
import { markBtwSideSession } from "./server-session-registry"

export const BTW_BOUNDARY_SENTINEL = "<omo-btw-boundary>"
export {
  BTW_PARENT_CONTEXT_MAX_BYTES,
  BTW_PARENT_CONTEXT_MAX_MESSAGES,
} from "./parent-context-budget"

const MAX_METADATA_LOOKUP_ATTEMPTS = 2

// Byte-stability contract (prefix-stability scenarios S1/S2): the sentinel,
// boundary text, and metadata key below are pinned prefix bytes. The boundary
// travels as the leading payload message so later transforms reproduce the
// same bytes at the same position. Any byte change must fail
// boundary-bytes.test.ts first. Do not edit without review.
export const BTW_BOUNDARY_METADATA_KEY = "btw-side-boundary"
export const BTW_BOUNDARY_TEXT = `${BTW_BOUNDARY_SENTINEL}
Treat all earlier messages as read-only background from the main conversation.
Answer only the side conversation that follows.
Do not mutate files or external state unless the side request explicitly asks for it.
Do not delegate work to subagents from this side conversation.`

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type SessionWithMetadata = Session & {
  metadata?: Record<string, unknown>
}

type SideMetadataCacheEntry = BtwSideMetadata | null

function cloneMessages(messages: MessageWithParts[]): MessageWithParts[] {
  return messages.map((message) => ({
    info: { ...message.info },
    parts: message.parts.map((part) => ({ ...part })),
  }))
}

export function btwBoundaryMessageID(sideSessionID: string): string {
  return `${sideSessionID}_btw_boundary`
}

function createPinnedBoundaryMessage(
  sideSessionID: string,
  source: MessageWithParts,
): MessageWithParts {
  const messageID = btwBoundaryMessageID(sideSessionID)
  const fields = source.info as unknown as Record<string, unknown>
  const agent = typeof fields["agent"] === "string" ? fields["agent"] : "sisyphus"
  const model = fields["model"]
  const modelFields =
    model && typeof model === "object" && !Array.isArray(model)
      ? (model as Record<string, unknown>)
      : undefined
  const providerID =
    typeof modelFields?.["providerID"] === "string"
      ? modelFields["providerID"]
      : "internal"
  const modelID =
    typeof modelFields?.["modelID"] === "string"
      ? modelFields["modelID"]
      : "btw-boundary"
  return {
    info: {
      id: messageID,
      sessionID: sideSessionID,
      role: "user",
      time: { created: 0 },
      agent,
      model: { providerID, modelID },
    },
    parts: [
      {
        id: `${messageID}_text`,
        messageID,
        sessionID: sideSessionID,
        type: "text",
        text: BTW_BOUNDARY_TEXT,
        synthetic: true,
        metadata: { [BTW_BOUNDARY_METADATA_KEY]: true },
      },
    ],
  }
}

function frontLoadBoundaryMessage(
  messages: MessageWithParts[],
  boundary: MessageWithParts,
): void {
  const existingIndex = messages.findIndex(
    (message) => message.info.id === boundary.info.id,
  )
  if (existingIndex === 0) return
  if (existingIndex > 0) messages.splice(existingIndex, 1)
  messages.unshift(boundary)
}

export function createBtwSideContextInjectorHook(args: {
  client: PluginContext["client"]
}) {
  const MAX_METADATA_CACHE_ENTRIES = 512
  const MAX_PARENT_CONTEXT_CACHE_ENTRIES = 32
  const metadataCache = new Map<string, SideMetadataCacheEntry>()
  const parentContextCache = new Map<string, MessageWithParts[]>()

  function rememberBounded<K, V>(
    cache: Map<K, V>,
    key: K,
    value: V,
    maxEntries: number,
  ): void {
    if (!cache.has(key) && cache.size >= maxEntries) {
      const oldestKey = cache.keys().next().value
      if (oldestKey !== undefined) cache.delete(oldestKey)
    }
    cache.set(key, value)
  }

  async function resolveMetadata(sessionID: string): Promise<BtwSideMetadata | undefined> {
    const cached = metadataCache.get(sessionID)
    if (cached !== undefined) return cached ?? undefined

    let lastError: unknown
    for (
      let attempt = 1;
      attempt <= MAX_METADATA_LOOKUP_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const response = await args.client.session.get({
          path: { id: sessionID },
        })
        if (isRecord(response) && response["error"] !== undefined) {
          throw new Error("Unable to read BTW session metadata", {
            cause: response["error"],
          })
        }
        const session = normalizeSDKResponse<SessionWithMetadata | undefined>(
          response,
          undefined,
          { preferResponseOnMissingData: true },
        )
        const metadata = getBtwSideMetadata(session)
        if (metadata) markBtwSideSession(sessionID)
        rememberBounded(
          metadataCache,
          sessionID,
          metadata ?? null,
          MAX_METADATA_CACHE_ENTRIES,
        )
        return metadata
      } catch (error) {
        lastError = error
        log("[btw-side] Failed to read side session metadata", {
          sessionID,
          attempt,
          error,
        })
      }
    }
    throw new Error("Unable to classify session for BTW isolation.", {
      cause: lastError,
    })
  }

  async function loadParentContext(
    sideSessionID: string,
    metadata: BtwSideMetadata,
  ): Promise<MessageWithParts[] | undefined> {
    const cached = parentContextCache.get(sideSessionID)
    if (cached) return cloneMessages(cached)

    try {
      const response = await args.client.session.messages({
        path: { id: metadata.parent_session_id },
      })
      const parentMessages = normalizeSDKResponse<MessageWithParts[]>(response, [])
      const boundaryIndex = parentMessages.findIndex(
        (message) => message.info.id === metadata.boundary_message_id,
      )
      if (boundaryIndex === -1) {
        log("[btw-side] Parent boundary message is unavailable", {
          sideSessionID,
          parentSessionID: metadata.parent_session_id,
          boundaryMessageID: metadata.boundary_message_id,
        })
        return undefined
      }
      const bounded = boundBtwParentContext(
        parentMessages.slice(0, boundaryIndex + 1),
      )
      rememberBounded(
        parentContextCache,
        sideSessionID,
        bounded,
        MAX_PARENT_CONTEXT_CACHE_ENTRIES,
      )
      return cloneMessages(bounded)
    } catch (error) {
      log("[btw-side] Failed to load parent context", {
        sideSessionID,
        parentSessionID: metadata.parent_session_id,
        error,
      })
      return undefined
    }
  }

  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      const sideSessionID = output.messages.at(-1)?.info.sessionID
      if (!sideSessionID) return

      const metadata = await resolveMetadata(sideSessionID)
      if (!metadata) return
      if (
        output.messages.some(
          (message) => message.info.sessionID === metadata.parent_session_id,
        )
      ) {
        return
      }

      const firstSideUserMessage = output.messages.find(
        (message) =>
          message.info.sessionID === sideSessionID &&
          message.info.role === "user",
      )
      if (!firstSideUserMessage) return

      const parentContext = await loadParentContext(sideSessionID, metadata)
      if (parentContext) {
        output.messages.unshift(...parentContext)
      }
      frontLoadBoundaryMessage(
        output.messages,
        createPinnedBoundaryMessage(sideSessionID, firstSideUserMessage),
      )
    },
  }
}
