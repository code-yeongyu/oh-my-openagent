import { isCompactionMessage } from "../../shared/compaction-marker"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import type { StoredMessage, ToolPermission } from "./types"

export type OpencodeClient = {
  readonly session: {
    readonly messages: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

export interface SDKMessage {
  readonly id?: string
  readonly info?: {
    readonly agent?: string
    readonly model?: {
      readonly providerID?: string
      readonly modelID?: string
      readonly variant?: string
    }
    readonly providerID?: string
    readonly modelID?: string
    readonly tools?: Record<string, ToolPermission>
    readonly time?: {
      readonly created?: number
    }
  }
  readonly parts?: readonly { readonly type?: string }[]
}

function convertSDKMessageToStoredMessage(msg: SDKMessage): StoredMessage | null {
  if (isCompactionMessage(msg)) {
    return null
  }

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

export async function fetchSDKMessages(client: OpencodeClient, sessionID: string): Promise<SDKMessage[] | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const emptyMessages: SDKMessage[] = []
    return normalizeSDKResponse(response, emptyMessages, { preferResponseOnMissingData: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[hook-message-injector] SDK message fetch failed", {
      sessionID,
      error: errorMessage,
    })
  }
  return null
}

export function findNearestMessageWithFieldsFromMessages(messages: readonly SDKMessage[]): StoredMessage | null {
  const sortedMessages = messages
    .map((message) => ({
      stored: convertSDKMessageToStoredMessage(message),
      createdAt: message.info?.time?.created ?? Number.NEGATIVE_INFINITY,
      id: typeof message.id === "string" ? message.id : "",
    }))
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))

  for (const message of sortedMessages) {
    const stored = message.stored
    if (stored?.agent && stored.model?.providerID && stored.model?.modelID) {
      return stored
    }
  }

  for (const message of sortedMessages) {
    const stored = message.stored
    if (stored?.agent || (stored?.model?.providerID && stored?.model?.modelID)) {
      return stored
    }
  }

  return null
}

export function findFirstMessageWithAgentFromMessages(messages: readonly SDKMessage[]): string | null {
  const sortedMessages = [...messages].sort((left, right) => {
    const leftTime = left.info?.time?.created ?? Number.POSITIVE_INFINITY
    const rightTime = right.info?.time?.created ?? Number.POSITIVE_INFINITY
    if (leftTime !== rightTime) return leftTime - rightTime
    const leftId = typeof left.id === "string" ? left.id : ""
    const rightId = typeof right.id === "string" ? right.id : ""
    return leftId.localeCompare(rightId)
  })

  for (const msg of sortedMessages) {
    const stored = convertSDKMessageToStoredMessage(msg)
    if (stored?.agent) {
      return stored.agent
    }
  }

  return null
}

export async function findNearestMessageWithFieldsFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<StoredMessage | null> {
  const messages = await fetchSDKMessages(client, sessionID)
  return messages ? findNearestMessageWithFieldsFromMessages(messages) : null
}

export async function findFirstMessageWithAgentFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<string | null> {
  const messages = await fetchSDKMessages(client, sessionID)
  return messages ? findFirstMessageWithAgentFromMessages(messages) : null
}
