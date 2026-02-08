import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { z } from "zod"
import { acquireLock, ensureDir } from "../../features/claude-tasks/storage"
import { getTeamInboxDir, getTeamInboxPath } from "./paths"
import { TeamInboxMessage, TeamInboxMessageSchema } from "./types"

const TeamInboxListSchema = z.array(TeamInboxMessageSchema)

function nowIso(): string {
  return new Date().toISOString()
}

function withInboxLock<T>(teamName: string, operation: () => T): T {
  const inboxDir = getTeamInboxDir(teamName)
  ensureDir(inboxDir)
  const lock = acquireLock(inboxDir)
  if (!lock.acquired) {
    throw new Error("inbox_lock_unavailable")
  }

  try {
    return operation()
  } finally {
    lock.release()
  }
}

function parseInboxFile(content: string): TeamInboxMessage[] {
  try {
    const parsed = JSON.parse(content)
    const result = TeamInboxListSchema.safeParse(parsed)
    return result.success ? result.data : []
  } catch {
    return []
  }
}

function readInboxMessages(teamName: string, agentName: string): TeamInboxMessage[] {
  const path = getTeamInboxPath(teamName, agentName)
  if (!existsSync(path)) {
    return []
  }
  return parseInboxFile(readFileSync(path, "utf-8"))
}

function writeInboxMessages(teamName: string, agentName: string, messages: TeamInboxMessage[]): void {
  const path = getTeamInboxPath(teamName, agentName)
  writeFileSync(path, JSON.stringify(messages), "utf-8")
}

export function ensureInbox(teamName: string, agentName: string): void {
  withInboxLock(teamName, () => {
    const path = getTeamInboxPath(teamName, agentName)
    if (!existsSync(path)) {
      writeFileSync(path, "[]", "utf-8")
    }
  })
}

export function appendInboxMessage(teamName: string, agentName: string, message: TeamInboxMessage): void {
  withInboxLock(teamName, () => {
    const path = getTeamInboxPath(teamName, agentName)
    if (!existsSync(path)) {
      writeFileSync(path, "[]", "utf-8")
    }
    const messages = readInboxMessages(teamName, agentName)
    messages.push(TeamInboxMessageSchema.parse(message))
    writeInboxMessages(teamName, agentName, messages)
  })
}

export function sendPlainInboxMessage(
  teamName: string,
  from: string,
  to: string,
  text: string,
  summary: string,
  color?: string,
): void {
  appendInboxMessage(teamName, to, {
    from,
    text,
    timestamp: nowIso(),
    read: false,
    summary,
    ...(color ? { color } : {}),
  })
}

export function sendStructuredInboxMessage(
  teamName: string,
  from: string,
  to: string,
  payload: Record<string, unknown>,
  summary?: string,
): void {
  appendInboxMessage(teamName, to, {
    from,
    text: JSON.stringify(payload),
    timestamp: nowIso(),
    read: false,
    ...(summary ? { summary } : {}),
  })
}

export function readInbox(
  teamName: string,
  agentName: string,
  unreadOnly = false,
  markAsRead = true,
): TeamInboxMessage[] {
  return withInboxLock(teamName, () => {
    const messages = readInboxMessages(teamName, agentName)

    const selected = unreadOnly ? messages.filter((message) => !message.read) : [...messages]

    if (!markAsRead || selected.length === 0) {
      return selected
    }

    const updated = messages.map((message) => {
      if (!unreadOnly) {
        return { ...message, read: true }
      }

      if (selected.some((selectedMessage) => selectedMessage.timestamp === message.timestamp && selectedMessage.from === message.from && selectedMessage.text === message.text)) {
        return { ...message, read: true }
      }
      return message
    })

    writeInboxMessages(teamName, agentName, updated)
    return selected
  })
}

export function buildShutdownRequestId(recipient: string): string {
  return `shutdown-${Date.now()}@${recipient}`
}
