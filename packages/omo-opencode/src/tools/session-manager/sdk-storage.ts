import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSDKResponse } from "../../shared"
import type { SessionMessage, SessionMetadata, TodoItem } from "./types"
import { sessionDirectoriesMatch } from "./directory-filter"
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

const SDK_TRANSIENT_RETRY_ATTEMPTS = 3

// session_read checks existence and then reads messages through SDK calls,
// so a single transient HTTP failure on either call would fall back to file storage,
// which does not exist for pure-sqlite sessions and surfaces a false "Session not found".
// Retry only on transient/unavailable errors; semantic errors (e.g. "session not found")
// still throw immediately so the caller can decide between fallback and rethrow.
async function fetchSdkResponse(operation: () => Promise<unknown>): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 1; attempt <= SDK_TRANSIENT_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await operation()
      throwOnNonFallbackableSdkError(response)
      return response
    } catch (error) {
      lastError = error
      if (!isSessionSdkUnavailableError(error)) throw error
    }
  }
  throw lastError
}

export async function getSdkMainSessions(
  client: PluginInput["client"],
  directory?: string,
): Promise<SessionMetadata[]> {
  const response = await fetchSdkResponse(() => client.session.list())

  const sessions = normalizeSDKResponse(response, [] as SessionMetadata[])
  const mainSessions = sessions.filter((session) => !session.parentID)
  if (directory) {
    return mainSessions
      .filter((session) => sessionDirectoriesMatch(session.directory, directory))
      .sort((a, b) => b.time.updated - a.time.updated)
  }

  return mainSessions.sort((a, b) => b.time.updated - a.time.updated)
}

export async function getSdkAllSessions(client: PluginInput["client"]): Promise<string[]> {
  const response = await fetchSdkResponse(() => client.session.list())
  const sessions = normalizeSDKResponse(response, [] as SessionMetadata[])
  return sessions.map((session) => session.id)
}

export async function sdkSessionExists(client: PluginInput["client"], sessionID: string): Promise<boolean> {
  const messages = await getSdkSessionMessages(client, sessionID)
  return messages.length > 0
}

export async function getSdkSessionMessages(
  client: PluginInput["client"],
  sessionID: string,
): Promise<SessionMessage[]> {
  const response = await fetchSdkResponse(() => client.session.messages({ path: { id: sessionID } }))

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
  const response = await fetchSdkResponse(() => client.session.todo({ path: { id: sessionID } }))

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
