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

/**
 * Fetch the main sessions (sessions without a parentID).
 * Optionally filter by directory.
 */
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

/**
 * Fetch all session IDs from the SDK.
 */
export async function getSdkAllSessions(client: PluginInput["client"]): Promise<string[]> {
  const response = await client.session.list()
  throwOnNonFallbackableSdkError(response)
  const sessions = normalizeSDKResponse(response, [] as SessionMetadata[])
  return sessions.map((session) => session.id)
}

/**
 * Check if a session exists by querying the SDK.
 */
export async function sdkSessionExists(client: PluginInput["client"], sessionID: string): Promise<boolean> {
  const response = await client.session.list()
  throwOnNonFallbackableSdkError(response)
  const sessions = normalizeSDKResponse(response, [] as Array<{ id?: string }>)
  return sessions.some((session) => session.id === sessionID)
}

/**
 * Type guard for session messages with valid info.
 * Narrows the type so TypeScript knows info.id is definitely a string.
 */
type RawMessage = {
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
}

function hasValidInfo(message: RawMessage): message is RawMessage & {
  info: { id: string; role?: string; agent?: string; time?: { created?: number; updated?: number } }
} {
  return Boolean(message.info?.id)
}

/**
 * Fetch session messages from the SDK, filtering for valid entries.
 * Messages must have a valid info.id to be included.
 */
export async function getSdkSessionMessages(
  client: PluginInput["client"],
  sessionID: string,
): Promise<SessionMessage[]> {
  const response = await client.session.messages({ path: { id: sessionID } })
  throwOnNonFallbackableSdkError(response)

  const rawMessages = normalizeSDKResponse(response, [] as RawMessage[])

  const messages: SessionMessage[] = rawMessages
    .filter(hasValidInfo)
    .map((message) => {
      const info = message.info
      return {
        id: info.id,
        role: (info.role as "user" | "assistant") || "user",
        agent: info.agent,
        time: info.time?.created
          ? {
              created: info.time.created,
              updated: info.time.updated,
            }
          : undefined,
        parts:
          message.parts?.map((part) => ({
            id: part.id || `generated-${crypto.randomUUID()}`,
            type: part.type || "text",
            text: part.text,
            thinking: part.thinking,
            tool: part.tool,
            callID: part.callID,
            input: part.input,
            output: part.output,
            error: part.error,
          })) || [],
      }
    })

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
