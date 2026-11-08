import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSDKResponse } from "../../shared"
import type { SessionMessage, SessionMetadata, TodoItem } from "./types"
import { sessionDirectoriesMatch } from "./directory-filter"
import { isSessionSdkUnavailableError } from "./sdk-unavailable"
import { toSessionError } from "./session-error"

function unwrapSdkResponseError(response: unknown): unknown {
  if (!response || typeof response !== "object" || !("error" in response)) {
    return null
  }

  return (response as { error?: unknown }).error ?? null
}

function throwOnNonFallbackableSdkError(response: unknown): void {
  const error = unwrapSdkResponseError(response)
  if (!error) return
  throw toSessionError(error)
}

const SDK_TRANSIENT_RETRY_ATTEMPTS = 3
const GLOBAL_SESSION_PAGE_SIZE = 100

type ExperimentalSessionList = (input: { roots?: boolean; cursor?: number; limit: number }) => Promise<unknown>

export type GlobalSessionClient = { experimental: { session: { list: ExperimentalSessionList } } }

function getNextCursor(response: unknown): number | undefined {
  if (!response || typeof response !== "object" || !("response" in response)) return undefined

  const headers = response.response instanceof Response ? response.response.headers : undefined
  const cursorHeader = headers?.get("x-next-cursor")
  if (cursorHeader === undefined || cursorHeader === null) return undefined

  const cursor = Number(cursorHeader)
  return Number.isFinite(cursor) ? cursor : undefined
}

function isGlobalSessionListUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "NotFoundError"
}

async function getSdkGlobalSessions(
  client: GlobalSessionClient | undefined,
  options: {
    roots?: boolean
    limit?: number
    sessionMatches?: (session: SessionMetadata) => boolean
  },
): Promise<SessionMetadata[] | undefined> {
  if (!client) return undefined

  try {
    const desired = options.limit ?? Number.POSITIVE_INFINITY
    const sessions: SessionMetadata[] = []
    let matched = 0
    let cursor: number | undefined
    while (matched < desired) {
      const limit = options.sessionMatches
        ? GLOBAL_SESSION_PAGE_SIZE
        : Math.min(GLOBAL_SESSION_PAGE_SIZE, desired - matched)
      const input = {
        ...(options.roots === undefined ? {} : { roots: options.roots }),
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      }
      const response = await fetchSdkResponse(() => client.experimental.session.list(input))
      const pageSessions = normalizeSDKResponse(response, [] as SessionMetadata[])
      sessions.push(...pageSessions)
      matched += options.sessionMatches ? pageSessions.filter(options.sessionMatches).length : pageSessions.length

      const nextCursor = getNextCursor(response)
      if (nextCursor === undefined || nextCursor === cursor) return sessions
      cursor = nextCursor
    }
    return sessions
  } catch (error) {
    if (isGlobalSessionListUnavailable(error)) return undefined
    throw error
  }
}

// session_read checks existence and then reads messages through SDK calls,
// so a single transient HTTP failure on either call would fall back to file storage,
// which does not exist for pure-sqlite sessions and surfaces a false "Session not found".
// Retry only on transient/unavailable errors; semantic errors (e.g. "session not found")
// still throw immediately so the caller can decide between fallback and rethrow.
// An aborted read is never retried: its error text ("timed out") would otherwise look transient.
async function fetchSdkResponse(operation: () => Promise<unknown>, signal?: AbortSignal): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 1; attempt <= SDK_TRANSIENT_RETRY_ATTEMPTS; attempt++) {
    signal?.throwIfAborted()
    try {
      const response = await operation()
      throwOnNonFallbackableSdkError(response)
      return response
    } catch (error) {
      signal?.throwIfAborted()
      lastError = error
      if (!isSessionSdkUnavailableError(error)) throw error
    }
  }
  throw lastError
}

export async function getSdkMainSessions(
  client: PluginInput["client"],
  directory?: string,
  globalClient?: GlobalSessionClient,
  limit?: number,
): Promise<SessionMetadata[]> {
  const globalSessions = await getSdkGlobalSessions(globalClient, {
    roots: true,
    limit,
    sessionMatches: directory ? (session) => sessionDirectoriesMatch(session.directory, directory) : undefined,
  })
  const response = globalSessions ? undefined : await fetchSdkResponse(() => client.session.list())
  const sessions = globalSessions ?? normalizeSDKResponse(response, [] as SessionMetadata[])
  const mainSessions = sessions.filter((session) => !session.parentID)
  if (directory) {
    return mainSessions
      .filter((session) => sessionDirectoriesMatch(session.directory, directory))
      .sort((a, b) => b.time.updated - a.time.updated)
  }

  return mainSessions.sort((a, b) => b.time.updated - a.time.updated)
}

export async function getSdkAllSessions(
  client: PluginInput["client"],
  globalClient?: GlobalSessionClient,
  limit?: number,
): Promise<string[]> {
  const globalSessions = await getSdkGlobalSessions(globalClient, { limit })
  const response = globalSessions ? undefined : await fetchSdkResponse(() => client.session.list())
  const sessions = globalSessions ?? normalizeSDKResponse(response, [] as SessionMetadata[])
  return sessions
    .slice()
    .sort((a, b) => b.time.updated - a.time.updated)
    .map((session) => session.id)
}

export async function sdkSessionExists(client: PluginInput["client"], sessionID: string): Promise<boolean> {
  const page = await getSdkSessionMessagePage(client, sessionID, { limit: 1 })
  return page.messages.length > 0
}

// Reads every message in one request. Only for callers that asked for the whole session;
// bounded reads go through getSdkSessionMessagePage / forEachSdkSessionMessagePage.
export async function getSdkSessionMessages(
  client: PluginInput["client"],
  sessionID: string,
  signal?: AbortSignal,
): Promise<SessionMessage[]> {
  const response = await fetchSdkResponse(
    () => client.session.messages({ path: { id: sessionID }, ...(signal ? { signal } : {}) }),
    signal,
  )
  return toSessionMessages(response)
}

// OpenCode's GET /session/:id/message?limit=N returns the NEWEST N messages in ascending order and, when
// older ones remain, an X-Next-Cursor header to pass back as `before` (server MessageV2.page, OpenCode
// >= 1.2.19; omo requires >= 1.4.0). There is no oldest-first order, so every bounded read walks pages
// from the newest end.
export const SDK_MESSAGE_PAGE_SIZE = 100

// cursorReadable is false when the response exposed no headers, so whether older pages exist is unknown.
export type SessionMessagePage = { messages: SessionMessage[]; nextCursor?: string; cursorReadable: boolean }

export async function getSdkSessionMessagePage(
  client: PluginInput["client"],
  sessionID: string,
  page: { limit: number; before?: string },
  signal?: AbortSignal,
): Promise<SessionMessagePage> {
  // `before` is served by the route but missing from the v1 SDK's query type; the client serializes every query key.
  const query: { limit: number; before?: string } = page.before ? { limit: page.limit, before: page.before } : { limit: page.limit }
  const response = await fetchSdkResponse(
    () => client.session.messages({ path: { id: sessionID }, query, ...(signal ? { signal } : {}) }),
    signal,
  )
  const headers = getResponseHeaders(response)
  return {
    messages: toSessionMessages(response),
    nextCursor: headers?.get("x-next-cursor") || undefined,
    cursorReadable: headers !== undefined,
  }
}

// Visits pages newest-first; each page is in ascending order. Stops when `visit` returns false,
// when the server reports no older page, or (by throwing) when the signal aborts.
export async function forEachSdkSessionMessagePage(
  client: PluginInput["client"],
  sessionID: string,
  visit: (messages: SessionMessage[]) => boolean | void,
  options: { pageSize?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const pageSize = options.pageSize ?? SDK_MESSAGE_PAGE_SIZE
  let before: string | undefined
  while (true) {
    options.signal?.throwIfAborted()
    const page = await getSdkSessionMessagePage(client, sessionID, { limit: pageSize, before }, options.signal)
    if (page.messages.length === 0) return
    // A full page whose cursor cannot be read would end the walk early and silently truncate the session.
    if (!page.cursorReadable && page.messages.length >= pageSize) {
      throw new Error(`Cannot page session ${sessionID}: the message response exposed no headers, so older messages may remain unread`)
    }
    if (visit(page.messages) === false) return
    if (!page.nextCursor || page.nextCursor === before) return
    before = page.nextCursor
  }
}

// The `limit` newest (fromEnd) or oldest messages. fromEnd is one request. Oldest-first has no server
// order, so it walks pages back from the newest end and keeps only the oldest `limit` seen: memory stays
// at one page plus `limit`, while the request count grows with the session's length.
export async function getSdkSessionMessageWindow(
  client: PluginInput["client"],
  sessionID: string,
  window: { limit: number; fromEnd: boolean },
  signal?: AbortSignal,
): Promise<SessionMessage[]> {
  if (window.fromEnd) {
    const page = await getSdkSessionMessagePage(client, sessionID, { limit: window.limit }, signal)
    return page.messages.slice(-window.limit)
  }

  let oldest: SessionMessage[] = []
  await forEachSdkSessionMessagePage(
    client,
    sessionID,
    (messages) => {
      oldest = messages.concat(oldest).slice(0, window.limit)
    },
    { signal },
  )
  return oldest
}

// Duck-typed rather than `instanceof Response`, which fails for a Response from another realm or fetch polyfill.
function getResponseHeaders(response: unknown): { get(name: string): string | null } | undefined {
  if (!response || typeof response !== "object" || !("response" in response)) return undefined
  const raw = (response as { response?: { headers?: unknown } }).response?.headers
  if (!raw || typeof (raw as { get?: unknown }).get !== "function") return undefined
  return raw as { get(name: string): string | null }
}

function toSessionMessages(response: unknown): SessionMessage[] {
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
