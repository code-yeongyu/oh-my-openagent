import type { PluginInput } from "@opencode-ai/plugin"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { log } from "../../shared"
import { getFileAllSessions, getFileMainSessions, fileSessionExists, getFileSessionInfo, getFileSessionMessages, getFileSessionTodos, getFileSessionTranscript } from "./file-storage"
import { getSdkAllSessions, getSdkMainSessions, getSdkSessionMessages, getSdkSessionTodos, sdkSessionExists, shouldFallbackFromSdkError } from "./sdk-storage"
import type { SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types"

export interface GetMainSessionsOptions {
  directory?: string
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

// SDK client reference for beta mode
let sdkClient: PluginInput["client"] | null = null

export function setStorageClient(client: PluginInput["client"]): void {
  sdkClient = client
}

export function resetStorageClient(): void {
  sdkClient = null
}

export async function getMainSessions(options: GetMainSessionsOptions): Promise<SessionMetadata[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessions = await getSdkMainSessions(sdkClient, options.directory)
      const fileSessions = await getFileMainSessions(options.directory)
      return mergeSessionMetadataLists(sdkSessions, fileSessions)
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session list after SDK unavailable error", { error: String(error) })
    }
  }

  return getFileMainSessions(options.directory)
}

export async function getAllSessions(): Promise<string[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessionIds = await getSdkAllSessions(sdkClient)
      const fileSessionIds = await getFileAllSessions()
      return mergeSessionIds(sdkSessionIds, fileSessionIds)
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session ids after SDK unavailable error", { error: String(error) })
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
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file sessionExists after SDK unavailable error", { error: String(error), sessionID })
    }
  }
  return fileSessionExists(sessionID)
}

export async function readSessionMessages(sessionID: string): Promise<SessionMessage[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkMessages = await getSdkSessionMessages(sdkClient, sessionID)
      if (sdkMessages.length > 0) return sdkMessages
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session messages after SDK unavailable error", { error: String(error), sessionID })
    }
  }

  return getFileSessionMessages(sessionID)
}

export async function readSessionTodos(sessionID: string): Promise<TodoItem[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkTodos = await getSdkSessionTodos(sdkClient, sessionID)
      if (sdkTodos.length > 0) return sdkTodos
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session todos after SDK unavailable error", { error: String(error), sessionID })
    }
  }

  return getFileSessionTodos(sessionID)
}

export async function readSessionTranscript(sessionID: string): Promise<number> {
  return getFileSessionTranscript(sessionID)
}

export async function getSessionInfo(sessionID: string): Promise<SessionInfo | null> {
  return getFileSessionInfo(sessionID)
}
