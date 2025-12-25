import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE, TODO_DIR, TRANSCRIPT_DIR } from "./constants"
import type { SessionMessage, SessionInfo, TodoItem } from "./types"

export function getAllSessions(): string[] {
  if (!existsSync(MESSAGE_STORAGE)) return []

  const sessions: string[] = []

  function scanDirectory(dir: string): void {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const sessionPath = join(dir, entry.name)
          const files = readdirSync(sessionPath)
          if (files.some((f) => f.endsWith(".json"))) {
            sessions.push(entry.name)
          } else {
            scanDirectory(sessionPath)
          }
        }
      }
    } catch {
      return
    }
  }

  scanDirectory(MESSAGE_STORAGE)
  return [...new Set(sessions)]
}

export function getMessageDir(sessionID: string): string {
  if (!existsSync(MESSAGE_STORAGE)) return ""

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) {
      return sessionPath
    }
  }

  return ""
}

export function sessionExists(sessionID: string): boolean {
  return getMessageDir(sessionID) !== ""
}

export function readSessionMessages(sessionID: string): SessionMessage[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messages: SessionMessage[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(messageDir, file), "utf-8")
      const meta = JSON.parse(content)

      const parts = readParts(meta.id)

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

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

function readParts(messageID: string): Array<{ id: string; type: string; [key: string]: unknown }> {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: Array<{ id: string; type: string; [key: string]: unknown }> = []
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(partDir, file), "utf-8")
      parts.push(JSON.parse(content))
    } catch {
      continue
    }
  }

  return parts.sort((a, b) => a.id.localeCompare(b.id))
}

export function readSessionTodos(sessionID: string): TodoItem[] {
  if (!existsSync(TODO_DIR)) return []

  const todoFiles = readdirSync(TODO_DIR).filter((f) => f.includes(sessionID) && f.endsWith(".json"))

  for (const file of todoFiles) {
    try {
      const content = readFileSync(join(TODO_DIR, file), "utf-8")
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

  return []
}

export function readSessionTranscript(sessionID: string): number {
  if (!existsSync(TRANSCRIPT_DIR)) return 0

  const transcriptFile = join(TRANSCRIPT_DIR, `${sessionID}.jsonl`)
  if (!existsSync(transcriptFile)) return 0

  try {
    const content = readFileSync(transcriptFile, "utf-8")
    return content.trim().split("\n").filter(Boolean).length
  } catch {
    return 0
  }
}

export function getSessionInfo(sessionID: string): SessionInfo | null {
  const messages = readSessionMessages(sessionID)
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

  const todos = readSessionTodos(sessionID)
  const transcriptEntries = readSessionTranscript(sessionID)

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
