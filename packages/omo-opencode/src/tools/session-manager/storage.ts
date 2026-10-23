import type { PluginInput } from "@opencode-ai/plugin"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { log } from "../../shared"
import { forEachFileSessionMessagePage, getFileAllSessions, getFileMainSessions, fileSessionExists, getFileSessionInfo, getFileSessionMessages, getFileSessionTodos, getFileSessionTranscript } from "./file-storage"
import { forEachSdkSessionMessagePage, getSdkAllSessions, getSdkMainSessions, getSdkSessionMessages, getSdkSessionMessageWindow, getSdkSessionTodos, sdkSessionExists, SDK_MESSAGE_PAGE_SIZE, shouldFallbackFromSdkError, type GlobalSessionClient } from "./sdk-storage"
import type { SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types"
import { describeSessionError } from "./session-error"

// A session that exists only in OpenCode's legacy JSON storage is listed, but the SQLite server answers
// NotFoundError for it (#5854). For a single session that means "not in the SDK", so the reader goes on to
// file storage, exactly as it does for an SDK read that came back empty.
function isSdkSessionNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError"
}

function shouldReadFileSession(error: unknown): boolean {
  return shouldFallbackFromSdkError(error) || isSdkSessionNotFound(error)
}

export interface GetMainSessionsOptions {
  directory?: string
  limit?: number
}

// In multi-project server mode (opencode web / opencode serve) ctx.directory is the
// filesystem root "/", which never matches a stored session.directory. Treat it as
// "no project filter" so every session is listed instead of silently dropping all of them.
function normalizeProjectFilter(directory?: string): string | undefined {
  if (directory === "/") return undefined
  return directory
}

function mergeSessionMetadataLists(
  sdkSessions: SessionMetadata[],
  fileSessions: SessionMetadata[],
): SessionMetadata[] {
  const merged = new Map<string, SessionMetadata>()

  for (const session of fileSessions) {
    merged.set(session.id, session)
  }

  for (const session of sdkSessions) {
    merged.set(session.id, session)
  }

  return [...merged.values()].sort((a, b) => b.time.updated - a.time.updated)
}

function mergeSessionIds(sdkSessionIds: string[], fileSessionIds: string[]): string[] {
  return [...new Set([...sdkSessionIds, ...fileSessionIds])]
}

// SDK clients for beta mode
let sdkClient: PluginInput["client"] | null = null
let globalSessionClient: GlobalSessionClient | null = null

export function setStorageClient(client: PluginInput["client"], globalClient?: GlobalSessionClient): void {
  sdkClient = client
  globalSessionClient = globalClient ?? null
}

export function resetStorageClient(): void {
  sdkClient = null
  globalSessionClient = null
}

export async function getMainSessions(options: GetMainSessionsOptions): Promise<SessionMetadata[]> {
  const directory = normalizeProjectFilter(options.directory)
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessions = await getSdkMainSessions(sdkClient, directory, globalSessionClient ?? undefined, options.limit)
      const fileSessions = await getFileMainSessions(directory)
      return mergeSessionMetadataLists(sdkSessions, fileSessions)
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session list after SDK unavailable error", { error: describeSessionError(error) })
    }
  }

  return getFileMainSessions(directory)
}

export async function getAllSessions(limit?: number): Promise<string[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessionIds = await getSdkAllSessions(sdkClient, globalSessionClient ?? undefined, limit)
      const fileSessionIds = await getFileAllSessions()
      return mergeSessionIds(sdkSessionIds, fileSessionIds)
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session ids after SDK unavailable error", { error: describeSessionError(error) })
    }
  }

  return getFileAllSessions()
}

export { getMessageDir } from "../../shared/opencode-message-dir"

export async function sessionExists(sessionID: string): Promise<boolean> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const existsInSdk = await sdkSessionExists(sdkClient, sessionID)
      if (existsInSdk) return true
    } catch (error) {
      if (!shouldReadFileSession(error)) throw error
      log("[session-manager] reading file sessionExists after SDK error", { error: describeSessionError(error), sessionID })
    }
  }
  return fileSessionExists(sessionID)
}

export type ReadSessionMessagesOptions = {
  // With a limit, only that many messages (the newest when fromEnd, else the oldest) are ever held.
  limit?: number
  fromEnd?: boolean
  signal?: AbortSignal
}

export async function readSessionMessages(sessionID: string, options: ReadSessionMessagesOptions = {}): Promise<SessionMessage[]> {
  const window = options.limit && options.limit > 0 ? { limit: options.limit, fromEnd: options.fromEnd === true } : undefined
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkMessages = window
        ? await getSdkSessionMessageWindow(sdkClient, sessionID, window, options.signal)
        : await getSdkSessionMessages(sdkClient, sessionID, options.signal)
      if (sdkMessages.length > 0) return sdkMessages
    } catch (error) {
      options.signal?.throwIfAborted()
      if (!shouldReadFileSession(error)) throw error
      log("[session-manager] reading file session messages after SDK error", { error: describeSessionError(error), sessionID })
    }
  }

  return getFileSessionMessages(sessionID, window, options.signal)
}

// Walks a session newest page first (each page ascending) without holding more than one page.
// `visit` returns false to stop early; an aborted signal stops the walk by throwing its reason.
export async function forEachSessionMessagePage(
  sessionID: string,
  visit: (messages: SessionMessage[]) => boolean | void,
  signal?: AbortSignal,
): Promise<void> {
  if (isSqliteBackend() && sdkClient) {
    let visitedPages = 0
    try {
      await forEachSdkSessionMessagePage(
        sdkClient,
        sessionID,
        (messages) => {
          visitedPages++
          return visit(messages)
        },
        { signal },
      )
      if (visitedPages > 0) return
    } catch (error) {
      signal?.throwIfAborted()
      // Pages already visited cannot be replayed from file storage without double-counting them.
      if (visitedPages > 0 || !shouldReadFileSession(error)) throw error
      log("[session-manager] reading file session pages after SDK error", { error: describeSessionError(error), sessionID })
    }
  }

  await forEachFileSessionMessagePage(sessionID, visit, { pageSize: SDK_MESSAGE_PAGE_SIZE, signal })
}

export async function readSessionTodos(sessionID: string): Promise<TodoItem[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkTodos = await getSdkSessionTodos(sdkClient, sessionID)
      if (sdkTodos.length > 0) return sdkTodos
    } catch (error) {
      if (!shouldReadFileSession(error)) throw error
      log("[session-manager] reading file session todos after SDK error", { error: describeSessionError(error), sessionID })
    }
  }

  return getFileSessionTodos(sessionID)
}

export async function readSessionTranscript(sessionID: string): Promise<number> {
  return getFileSessionTranscript(sessionID)
}

export async function getSessionInfo(sessionID: string, signal?: AbortSignal): Promise<SessionInfo | null> {
  if (isSqliteBackend() && sdkClient) {
    try {
      // Counted page by page so the session is never held whole.
      let messageCount = 0
      const agentsUsed = new Set<string>()
      let firstMessage: Date | undefined
      let lastMessage: Date | undefined
      await forEachSdkSessionMessagePage(sdkClient, sessionID, (messages) => {
        messageCount += messages.length
        for (const msg of messages) {
          if (msg.agent) agentsUsed.add(msg.agent)
          if (msg.time?.created) {
            const date = new Date(msg.time.created)
            if (!firstMessage || date < firstMessage) firstMessage = date
            if (!lastMessage || date > lastMessage) lastMessage = date
          }
        }
      }, { signal })
      if (messageCount > 0) {
        const todos = await readSessionTodos(sessionID)
        const transcriptEntries = await readSessionTranscript(sessionID)

        return {
          id: sessionID,
          message_count: messageCount,
          first_message: firstMessage,
          last_message: lastMessage,
          agents_used: Array.from(agentsUsed),
          has_todos: todos.length > 0,
          has_transcript: transcriptEntries > 0,
          todos,
          transcript_entries: transcriptEntries,
        }
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (!shouldReadFileSession(error)) throw error
      log("[session-manager] reading file session info after SDK error", { error: describeSessionError(error), sessionID })
    }
  }

  return getFileSessionInfo(sessionID, signal)
}
