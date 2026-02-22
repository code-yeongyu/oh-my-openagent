import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { MESSAGE_STORAGE, PART_STORAGE, SESSION_STORAGE, TODO_DIR, TRANSCRIPT_DIR } from "./constants"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { getMessageDir } from "../../shared/opencode-message-dir"
import type { SessionMessage, SessionInfo, TodoItem, SessionMetadata } from "./types"
import { normalizeSDKResponse } from "../../shared"

export interface GetMainSessionsOptions {
  directory?: string
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
  // Beta mode: use SDK
  if (isSqliteBackend() && sdkClient) {
    try {
      const response = await sdkClient.session.list()
      const sessions = normalizeSDKResponse(response, [] as SessionMetadata[])
      const mainSessions = sessions.filter((s) => !s.parentID)
      if (options.directory) {
        return mainSessions
          .filter((s) => s.directory === options.directory)
          .sort((a, b) => b.time.updated - a.time.updated)
      }
      return mainSessions.sort((a, b) => b.time.updated - a.time.updated)
    } catch {
      return []
    }
  }

  // Stable mode: use JSON files
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

          if (options.directory && meta.directory !== options.directory) continue

          sessions.push(meta)
        } catch {
          continue
        }
      }
    }
  } catch {
    return []
  }

  return sessions.sort((a, b) => b.time.updated - a.time.updated)
}

export async function getAllSessions(): Promise<string[]> {
  // Beta mode: use SDK
  if (isSqliteBackend() && sdkClient) {
    try {
      const response = await sdkClient.session.list()
      const sessions = normalizeSDKResponse(response, [] as SessionMetadata[])
      return sessions.map((s) => s.id)
    } catch {
      return []
    }
  }

  // Stable mode: use JSON files
  if (!existsSync(MESSAGE_STORAGE)) return []

  const sessions: string[] = []

  async function scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionPath = join(dir, entry.name)
          const files = await readdir(sessionPath)
          if (files.some((f) => f.endsWith(".json"))) {
            sessions.push(entry.name)
          } else {
            await scanDirectory(sessionPath)
          }
        }
      }
    } catch {
      return
    }
  }

  await scanDirectory(MESSAGE_STORAGE)
  return [...new Set(sessions)]
}

export { getMessageDir } from "../../shared/opencode-message-dir"

export async function sessionExists(sessionID: string): Promise<boolean> {
  if (isSqliteBackend() && sdkClient) {
    const response = await sdkClient.session.list()
    const sessions = normalizeSDKResponse(response, [] as Array<{ id?: string }>)
    return sessions.some((s) => s.id === sessionID)
  }
  return getMessageDir(sessionID) !== null
}

export async function readSessionMessages(sessionID: string): Promise<SessionMessage[]> {
  // Beta mode: use SDK
  if (isSqliteBackend() && sdkClient) {
    try {
      const response = await sdkClient.session.messages({ path: { id: sessionID } })
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
        .filter((m) => m.info?.id)
        .map((m) => ({
          id: m.info!.id!,
          role: (m.info!.role as "user" | "assistant") || "user",
          agent: m.info!.agent,
          time: m.info!.time?.created
            ? {
                created: m.info!.time.created,
                updated: m.info!.time.updated,
              }
            : undefined,
          parts:
            m.parts?.map((p) => ({
              id: p.id || "",
              type: p.type || "text",
              text: p.text,
              thinking: p.thinking,
              tool: p.tool,
              callID: p.callID,
              input: p.input,
              output: p.output,
              error: p.error,
            })) || [],
        }))
      return messages.sort((a, b) => {
        const aTime = a.time?.created ?? 0
        const bTime = b.time?.created ?? 0
        if (aTime !== bTime) return aTime - bTime
        return a.id.localeCompare(b.id)
      })
    } catch {
      return []
    }
  }

  // Stable mode: use JSON files
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messages: SessionMessage[] = []
  try {
    const files = await readdir(messageDir)
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        const content = await readFile(join(messageDir, file), "utf-8")
        const meta = JSON.parse(content)

        const parts = await readParts(meta.id)

        messages.push({
          id: meta.id,
          role: meta.role,
          agent: meta.agent,
          time: meta.time,
          parts,
        })
      } catch {
        continue
      }
    }
  } catch {
    return []
  }

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
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
      } catch {
        continue
      }
    }
  } catch {
    return []
  }

  return parts.sort((a, b) => a.id.localeCompare(b.id))
}

export async function readSessionTodos(sessionID: string): Promise<TodoItem[]> {
  // Beta mode: use SDK
  if (isSqliteBackend() && sdkClient) {
    try {
      const response = await sdkClient.session.todo({ path: { id: sessionID } })
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
    } catch {
      return []
    }
  }

  // Stable mode: use JSON files
  if (!existsSync(TODO_DIR)) return []

  try {
    const allFiles = await readdir(TODO_DIR)
    const todoFiles = allFiles.filter((f) => f.includes(sessionID) && f.endsWith(".json"))

    for (const file of todoFiles) {
      try {
        const content = await readFile(join(TODO_DIR, file), "utf-8")
        const data = JSON.parse(content)
        if (Array.isArray(data)) {
          return data.map((item) => ({
            id: item.id || "",
            content: item.content || "",
            status: item.status || "pending",
            priority: item.priority,
          }))
        }
      } catch {
        continue
      }
    }
  } catch {
    return []
  }

  return []
}

export async function readSessionTranscript(sessionID: string): Promise<number> {
  if (!existsSync(TRANSCRIPT_DIR)) return 0

  const transcriptFile = join(TRANSCRIPT_DIR, `${sessionID}.jsonl`)
  if (!existsSync(transcriptFile)) return 0

  try {
    const content = await readFile(transcriptFile, "utf-8")
    return content.trim().split("\n").filter(Boolean).length
  } catch {
    return 0
  }
}

export async function getSessionInfo(sessionID: string): Promise<SessionInfo | null> {
  const messages = await readSessionMessages(sessionID)
  if (messages.length === 0) return null

  const agentsUsed = new Set<string>()
  let firstMessage: Date | undefined
  let lastMessage: Date | undefined

  for (const msg of messages) {
    if (msg.agent) agentsUsed.add(msg.agent)
    if (msg.time?.created) {
      const date = new Date(msg.time.created)
      if (!firstMessage || date < firstMessage) firstMessage = date
      if (!lastMessage || date > lastMessage) lastMessage = date
    }
  }

  const todos = await readSessionTodos(sessionID)
  const transcriptEntries = await readSessionTranscript(sessionID)

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
