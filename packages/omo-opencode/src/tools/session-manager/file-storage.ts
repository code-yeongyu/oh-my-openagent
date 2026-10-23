import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE, SESSION_STORAGE, TODO_DIR, TRANSCRIPT_DIR } from "./constants"
import { getMessageDir } from "../../shared/opencode-message-dir"
import type { SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types"
import { sessionDirectoriesMatch } from "./directory-filter"

function ignoreFileStorageError(error: unknown): void {
  if (error instanceof Error) return
  throw error
}

export async function getFileMainSessions(directory?: string): Promise<SessionMetadata[]> {
  if (!existsSync(SESSION_STORAGE)) return []

  const sessions: SessionMetadata[] = []

  try {
    const projectDirs = await readdir(SESSION_STORAGE, { withFileTypes: true })
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue
      const projectPath = join(SESSION_STORAGE, projectDir.name)
      const sessionFiles = await readdir(projectPath)

      for (const file of sessionFiles) {
        if (!file.endsWith(".json")) continue

        try {
          const content = await readFile(join(projectPath, file), "utf-8")
          const meta = JSON.parse(content) as SessionMetadata
          if (meta.parentID) continue
          if (directory && !sessionDirectoriesMatch(meta.directory, directory)) continue
          sessions.push(meta)
        } catch (error) {
          ignoreFileStorageError(error)
          continue
        }
      }
    }
  } catch (error) {
    ignoreFileStorageError(error)
    return []
  }

  return sessions.sort((a, b) => b.time.updated - a.time.updated)
}

export async function getFileAllSessions(): Promise<string[]> {
  if (!existsSync(MESSAGE_STORAGE)) return []

  const sessions: string[] = []

  async function scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const sessionPath = join(dir, entry.name)
        const files = await readdir(sessionPath)
        if (files.some((file) => file.endsWith(".json"))) {
          sessions.push(entry.name)
          continue
        }
        await scanDirectory(sessionPath)
      }
    } catch (error) {
      ignoreFileStorageError(error)
      return
    }
  }

  await scanDirectory(MESSAGE_STORAGE)
  return [...new Set(sessions)]
}

export async function fileSessionExists(sessionID: string): Promise<boolean> {
  return getMessageDir(sessionID) !== null
}

type FileMessageMeta = Omit<SessionMessage, "parts">

// Message metadata only, sorted oldest-first. Parts (where the bulk of a session lives) are read
// separately, only for the messages a caller actually returns or scans.
async function getFileSessionMessageMetas(sessionID: string, signal?: AbortSignal): Promise<FileMessageMeta[]> {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const metas: FileMessageMeta[] = []
  try {
    const files = await readdir(messageDir)
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      signal?.throwIfAborted()
      try {
        const content = await readFile(join(messageDir, file), "utf-8")
        const meta = JSON.parse(content)
        metas.push({
          id: meta.id,
          role: meta.role,
          agent: meta.agent,
          time: meta.time,
        })
      } catch (error) {
        ignoreFileStorageError(error)
        continue
      }
    }
  } catch (error) {
    // ignoreFileStorageError swallows every Error, which would turn a cancellation into an empty session.
    signal?.throwIfAborted()
    ignoreFileStorageError(error)
    return []
  }

  return metas.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

async function withParts(metas: FileMessageMeta[], signal?: AbortSignal): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = []
  for (const meta of metas) {
    signal?.throwIfAborted()
    messages.push({ ...meta, parts: await readParts(meta.id) })
  }
  return messages
}

export async function getFileSessionMessages(
  sessionID: string,
  window?: { limit: number; fromEnd: boolean },
  signal?: AbortSignal,
): Promise<SessionMessage[]> {
  const metas = await getFileSessionMessageMetas(sessionID, signal)
  if (!window) return withParts(metas, signal)
  return withParts(window.fromEnd ? metas.slice(-window.limit) : metas.slice(0, window.limit), signal)
}

// Same contract as forEachSdkSessionMessagePage: pages newest-first, each ascending.
export async function forEachFileSessionMessagePage(
  sessionID: string,
  visit: (messages: SessionMessage[]) => boolean | void,
  options: { pageSize: number; signal?: AbortSignal },
): Promise<void> {
  const metas = await getFileSessionMessageMetas(sessionID, options.signal)
  for (let end = metas.length; end > 0; end -= options.pageSize) {
    options.signal?.throwIfAborted()
    const page = await withParts(metas.slice(Math.max(0, end - options.pageSize), end), options.signal)
    if (visit(page) === false) return
  }
}

async function readParts(messageID: string): Promise<Array<{ id: string; type: string; [key: string]: unknown }>> {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: Array<{ id: string; type: string; [key: string]: unknown }> = []
  try {
    const files = await readdir(partDir)
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        const content = await readFile(join(partDir, file), "utf-8")
        parts.push(JSON.parse(content))
      } catch (error) {
        ignoreFileStorageError(error)
        continue
      }
    }
  } catch (error) {
    ignoreFileStorageError(error)
    return []
  }

  return parts.sort((a, b) => a.id.localeCompare(b.id))
}

export async function getFileSessionTodos(sessionID: string): Promise<TodoItem[]> {
  if (!existsSync(TODO_DIR)) return []

  try {
    const allFiles = await readdir(TODO_DIR)
    const todoFiles = allFiles.filter((file) => file === `${sessionID}.json`)

    for (const file of todoFiles) {
      try {
        const content = await readFile(join(TODO_DIR, file), "utf-8")
        const data = JSON.parse(content)
        if (!Array.isArray(data)) continue
        return data.map((item) => ({
          id: item.id || "",
          content: item.content || "",
          status: item.status || "pending",
          priority: item.priority,
        }))
      } catch (error) {
        ignoreFileStorageError(error)
        continue
      }
    }
  } catch (error) {
    ignoreFileStorageError(error)
    return []
  }

  return []
}

export async function getFileSessionTranscript(sessionID: string): Promise<number> {
  if (!existsSync(TRANSCRIPT_DIR)) return 0
  const transcriptFile = join(TRANSCRIPT_DIR, `${sessionID}.jsonl`)
  if (!existsSync(transcriptFile)) return 0

  try {
    const content = await readFile(transcriptFile, "utf-8")
    return content.trim().split("\n").filter(Boolean).length
  } catch (error) {
    ignoreFileStorageError(error)
    return 0
  }
}

export async function getFileSessionInfo(sessionID: string, signal?: AbortSignal): Promise<SessionInfo | null> {
  const messages = await getFileSessionMessageMetas(sessionID, signal)
  if (messages.length === 0) return null

  const agentsUsed = new Set<string>()
  let firstMessage: Date | undefined
  let lastMessage: Date | undefined

  for (const msg of messages) {
    if (msg.agent) agentsUsed.add(msg.agent)
    if (!msg.time?.created) continue
    const date = new Date(msg.time.created)
    if (!firstMessage || date < firstMessage) firstMessage = date
    if (!lastMessage || date > lastMessage) lastMessage = date
  }

  const todos = await getFileSessionTodos(sessionID)
  const transcriptEntries = await getFileSessionTranscript(sessionID)

  return {
    id: sessionID,
    message_count: messages.length,
    first_message: firstMessage,
    last_message: lastMessage,
    agents_used: Array.from(agentsUsed),
    has_todos: todos.length > 0,
    has_transcript: transcriptEntries > 0,
    todos,
    transcript_entries: transcriptEntries,
  }
}
