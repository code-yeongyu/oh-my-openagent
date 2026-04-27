import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSDKResponse } from "../../shared"
import type { SessionMessage, SessionMetadata, TodoItem } from "./types"
import { isSessionSdkUnavailableError } from "./sdk-unavailable"

function unwrapSdkResponseError(response: unknown): unknown {
  if (!response || typeof response !== "object" || !("error" in response)) {
    return null
  }

  return (response as { error?: unknown }).error ?? null
}

function throwOnNonFallbackableSdkError(response: unknown): void {
  const error = unwrapSdkResponseError(response)
  if (!error) return
  throw error
}

export async function getSdkMainSessions(
  client: PluginInput["client"],
  directory?: string,
): Promise<SessionMetadata[]> {
  const response = await client.session.list()
  const error = unwrapSdkResponseError(response)
  if (error) throw error

  const sessions = normalizeSDKResponse(response, [] as SessionMetadata[])
  const mainSessions = sessions.filter((session) => !session.parentID)
  if (directory) {
    return mainSessions
      .filter((session) => session.directory === directory)
      .sort((a, b) => b.time.updated - a.time.updated)
  }

  return mainSessions.sort((a, b) => b.time.updated - a.time.updated)
}

export async function getSdkAllSessions(client: PluginInput["client"]): Promise<string[]> {
  const response = await client.session.list()
  throwOnNonFallbackableSdkError(response)
  const sessions = normalizeSDKResponse(response, [] as SessionMetadata[])
  return sessions.map((session) => session.id)
}

export async function sdkSessionExists(client: PluginInput["client"], sessionID: string): Promise<boolean> {
  const response = await client.session.list()
  throwOnNonFallbackableSdkError(response)
  const sessions = normalizeSDKResponse(response, [] as Array<{ id?: string }>)
  return sessions.some((session) => session.id === sessionID)
}

export async function getSdkSessionMessages(
  client: PluginInput["client"],
  sessionID: string,
): Promise<SessionMessage[]> {
  const response = await client.session.messages({ path: { id: sessionID } })
  throwOnNonFallbackableSdkError(response)

  const rawMessages = normalizeSDKResponse(response, [] as Array<{
    info?: {
      id?: string
      role?: string
      agent?: string
      time?: { created?: number; updated?: number }
    }
    parts?: Array<{
      id?: string
      type?: string
      text?: string
      thinking?: string
      tool?: string
      callID?: string
      input?: Record<string, unknown>
      output?: string
      error?: string
    }>
  }>)

  const messages: SessionMessage[] = rawMessages
    .filter((message) => message.info?.id)
    .map((message) => ({
      id: message.info!.id!,
      role: (message.info!.role as "user" | "assistant") || "user",
      agent: message.info!.agent,
      time: message.info!.time?.created
        ? {
            created: message.info!.time.created,
            updated: message.info!.time.updated,
          }
        : undefined,
      parts:
        message.parts?.map((part) => ({
          id: part.id || "",
          type: part.type || "text",
          text: part.text,
          thinking: part.thinking,
          tool: part.tool,
          callID: part.callID,
          input: part.input,
          output: part.output,
          error: part.error,
        })) || [],
    }))

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

export async function getSdkSessionTodos(client: PluginInput["client"], sessionID: string): Promise<TodoItem[]> {
  const response = await client.session.todo({ path: { id: sessionID } })
  throwOnNonFallbackableSdkError(response)

  const data = normalizeSDKResponse(response, [] as Array<{
    id?: string
    content?: string
    status?: string
    priority?: string
  }>)

  return data.map((item) => ({
    id: item.id || "",
    content: item.content || "",
    status: (item.status as TodoItem["status"]) || "pending",
    priority: item.priority,
  }))
}

export function shouldFallbackFromSdkError(error: unknown): boolean {
  return isSessionSdkUnavailableError(error)
}
