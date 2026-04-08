import { normalizeSDKResponse } from "../shared"

type ReadyNotificationContext = {
  client: {
    session: {
      get?: (input: { path: { id: string } }) => Promise<unknown>
      messages?: (input: { path: { id: string }; query: { directory: string } }) => Promise<unknown>
    }
  }
  directory: string
}

type SessionInfo = {
  title?: string
}

type SessionMessagePart = {
  type?: string
  text?: string
}

type SessionMessage = {
  info?: {
    role?: string
    error?: unknown
  }
  parts?: SessionMessagePart[]
}

type ReadyNotificationInput = {
  sessionID: string
  baseTitle: string
  baseMessage: string
}

function extractMessageText(message: SessionMessage | undefined): string {
  return (message?.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
}

function collapseWhitespace(text: string): string {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
}

function getLastNonEmptyLine(text: string): string {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.at(-1) ?? ""
}

function findLastMessage(messages: SessionMessage[], role: "user" | "assistant"): SessionMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.info?.role !== role) continue
    if (role === "assistant" && message.info?.error) continue
    if (!extractMessageText(message)) continue
    return message
  }

  return undefined
}

async function readSessionTitle(
  ctx: ReadyNotificationContext,
  sessionID: string,
): Promise<string> {
  if (typeof ctx.client.session.get !== "function") {
    return sessionID
  }

  try {
    const response = await ctx.client.session.get({ path: { id: sessionID } })
    const sessionInfo = normalizeSDKResponse(response, null as SessionInfo | null, {
      preferResponseOnMissingData: true,
    })

    if (sessionInfo?.title && sessionInfo.title.trim().length > 0) {
      return sessionInfo.title.trim()
    }
  } catch {
  }

  return sessionID
}

async function readSessionMessages(
  ctx: ReadyNotificationContext,
  sessionID: string,
): Promise<SessionMessage[]> {
  if (typeof ctx.client.session.messages !== "function") {
    return []
  }

  try {
    const response = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory },
    })

    const messages = normalizeSDKResponse(response, [] as SessionMessage[], {
      preferResponseOnMissingData: true,
    })

    return Array.isArray(messages) ? messages : []
  } catch {
    return []
  }
}

export async function buildReadyNotificationContent(
  ctx: ReadyNotificationContext,
  input: ReadyNotificationInput,
): Promise<{ title: string; message: string }> {
  const [sessionTitle, messages] = await Promise.all([
    readSessionTitle(ctx, input.sessionID),
    readSessionMessages(ctx, input.sessionID),
  ])

  const lastUserText = collapseWhitespace(extractMessageText(findLastMessage(messages, "user")))
  const lastAssistantLine = getLastNonEmptyLine(
    extractMessageText(findLastMessage(messages, "assistant")),
  )

  const detailLines = [
    lastUserText ? `User: ${lastUserText}` : "",
    lastAssistantLine ? `Assistant: ${lastAssistantLine}` : "",
  ].filter(Boolean)

  return {
    title: `${input.baseTitle} · ${sessionTitle}`,
    message: detailLines.length > 0
      ? [input.baseMessage, ...detailLines].join("\n")
      : input.baseMessage,
  }
}
