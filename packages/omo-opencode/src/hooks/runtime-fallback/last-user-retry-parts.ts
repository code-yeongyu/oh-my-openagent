import { extractSessionMessages } from "./session-messages"
import {
  clearDelegatedChildSessionBootstrap,
  getDelegatedChildSessionBootstrap,
} from "../../shared/delegated-child-session-bootstrap"
import { hasCompactionPart } from "../../shared/compaction-marker"
import { hasSubstantivePromptText } from "../../shared/runtime-fallback-retry-marker"

type RetryPart = { type: "text"; text: string }

export type LastUserRetryPayload = {
  retryParts: RetryPart[]
  system?: string
  tools?: Record<string, boolean>
}

export function getLastUserRetryParts(
  messagesResponse: unknown,
  sessionID?: string,
): RetryPart[] {
  return getLastUserRetryPayload(messagesResponse, sessionID).retryParts
}

export function getLastUserRetryPayload(
  messagesResponse: unknown,
  sessionID?: string,
): LastUserRetryPayload {
  const bootstrap = sessionID ? getDelegatedChildSessionBootstrap(sessionID) : undefined
  const messages = extractSessionMessages(messagesResponse)
  const lastUserMessage = messages?.filter((message) => {
    if (message.info?.role !== "user") return false
    const propParts = Array.isArray(message.parts) ? message.parts : undefined
    const infoParts = Array.isArray(message.info?.parts) ? message.info.parts : undefined
    const parts = propParts && propParts.length > 0 ? propParts : infoParts
    if (hasCompactionPart(parts)) return false
    return hasSubstantivePromptText(parts)
  }).pop()
  const propParts = Array.isArray(lastUserMessage?.parts) ? lastUserMessage.parts : undefined
  const infoParts = Array.isArray(lastUserMessage?.info?.parts) ? lastUserMessage.info.parts : undefined
  const lastUserParts = propParts && propParts.length > 0 ? propParts : infoParts

  const retryParts = (lastUserParts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text"
        && typeof part.text === "string"
        && part.text.length > 0,
    )
    .map((part) => ({ type: "text" as const, text: part.text }))

  if (retryParts.length > 0) {
    if (sessionID) {
      clearDelegatedChildSessionBootstrap(sessionID)
    }
    return {
      retryParts,
      ...(bootstrap?.system ? { system: bootstrap.system } : {}),
      ...(bootstrap?.tools ? { tools: bootstrap.tools } : {}),
    }
  }

  if (!sessionID) {
    return { retryParts }
  }

  const bootstrapRetryParts = bootstrap?.retryParts ?? []
  if (bootstrapRetryParts.length > 0) {
    clearDelegatedChildSessionBootstrap(sessionID)
  }

  return {
    retryParts: bootstrapRetryParts,
    ...(bootstrap?.system ? { system: bootstrap.system } : {}),
    ...(bootstrap?.tools ? { tools: bootstrap.tools } : {}),
  }
}
