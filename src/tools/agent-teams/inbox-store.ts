import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { z } from "zod"
import { acquireLock, ensureDir, writeJsonAtomic } from "../../features/claude-tasks/storage"
import { getTeamInboxDir, getTeamInboxPath } from "./paths"
import { validateAgentNameOrLead, validateTeamName } from "./name-validation"
import { TeamInboxMessage, TeamInboxMessageSchema } from "./types"

const TeamInboxListSchema = z.array(TeamInboxMessageSchema)

function nowIso(): string {
  return new Date().toISOString()
}

function assertValidTeamName(teamName: string): void {
  const validationError = validateTeamName(teamName)
  if (validationError) {
    throw new Error(validationError)
  }
}

function assertValidInboxAgentName(agentName: string): void {
  const validationError = validateAgentNameOrLead(agentName)
  if (validationError) {
    throw new Error(validationError)
  }
}

function withInboxLock<T>(teamName: string, operation: () => T): T {
  assertValidTeamName(teamName)
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
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error("team_inbox_parse_failed")
  }

  const result = TeamInboxListSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error("team_inbox_schema_invalid")
  }

  return result.data
}

function readInboxMessages(teamName: string, agentName: string): TeamInboxMessage[] {
  assertValidTeamName(teamName)
  assertValidInboxAgentName(agentName)
  const path = getTeamInboxPath(teamName, agentName)
  if (!existsSync(path)) {
    return []
  }
  return parseInboxFile(readFileSync(path, "utf-8"))
}

function writeInboxMessages(teamName: string, agentName: string, messages: TeamInboxMessage[]): void {
  assertValidTeamName(teamName)
  assertValidInboxAgentName(agentName)
  const path = getTeamInboxPath(teamName, agentName)
  writeJsonAtomic(path, messages)
}

export function ensureInbox(teamName: string, agentName: string): void {
  assertValidTeamName(teamName)
  assertValidInboxAgentName(agentName)
  withInboxLock(teamName, () => {
    const path = getTeamInboxPath(teamName, agentName)
    if (!existsSync(path)) {
      writeJsonAtomic(path, [])
    }
  })
}

export function appendInboxMessage(teamName: string, agentName: string, message: TeamInboxMessage): void {
  assertValidTeamName(teamName)
  assertValidInboxAgentName(agentName)
  withInboxLock(teamName, () => {
    const path = getTeamInboxPath(teamName, agentName)
    const messages = existsSync(path) ? parseInboxFile(readFileSync(path, "utf-8")) : []
    messages.push(TeamInboxMessageSchema.parse(message))
    writeInboxMessages(teamName, agentName, messages)
  })
}

export function clearInbox(teamName: string, agentName: string): void {
  assertValidTeamName(teamName)
  assertValidInboxAgentName(agentName)
  withInboxLock(teamName, () => {
    const path = getTeamInboxPath(teamName, agentName)
    if (existsSync(path)) {
      unlinkSync(path)
    }
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

    const selectedIndexes = new Set<number>()
    const selected = unreadOnly
      ? messages.filter((message, index) => {
          if (!message.read) {
            selectedIndexes.add(index)
            return true
          }
          return false
        })
      : messages.map((message, index) => {
          selectedIndexes.add(index)
          return message
        })

    if (!markAsRead || selected.length === 0) {
      return selected
    }

    let changed = false

    const updated = messages.map((message, index) => {
      if (selectedIndexes.has(index) && !message.read) {
        changed = true
        return { ...message, read: true }
      }
      return message
    })

    if (changed) {
      writeInboxMessages(teamName, agentName, updated)
    }
    return updated.filter((_, index) => selectedIndexes.has(index))
  })
}

export function buildShutdownRequestId(recipient: string): string {
  return `shutdown-${Date.now()}@${recipient}`
}
