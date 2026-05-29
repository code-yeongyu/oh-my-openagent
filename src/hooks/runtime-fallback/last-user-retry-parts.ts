import { extractSessionMessages } from "./session-messages"
import {
  clearDelegatedChildSessionBootstrap,
  getDelegatedChildSessionBootstrap,
} from "../../shared/delegated-child-session-bootstrap"

type RetryPart = { type: "text"; text: string; id?: string }

export type LastUserRetryPayload = {
  retryParts: RetryPart[]
  system?: string
  tools?: Record<string, boolean>
  messageID?: string
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
  const lastUserMessage = messages?.filter((message) => message.info?.role === "user").pop()
  const messageID =
    typeof lastUserMessage?.info?.id === "string" ? lastUserMessage.info.id : undefined
  const lastUserParts =
    lastUserMessage?.parts
    ?? (lastUserMessage?.info?.parts as Array<{ type?: string; text?: string; id?: string }> | undefined)

  const retryParts = (lastUserParts ?? [])
    .filter(
      (part): part is { type: "text"; text: string; id?: string } =>
        part.type === "text"
        && typeof part.text === "string"
        && part.text.length > 0,
    )
    .map((part) => ({
      type: "text" as const,
      text: part.text,
      ...(typeof part.id === "string" ? { id: part.id } : {}),
    }))

  if (retryParts.length > 0) {
    if (sessionID) {
      clearDelegatedChildSessionBootstrap(sessionID)
    }
    return {
      retryParts,
      ...(messageID ? { messageID } : {}),
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
