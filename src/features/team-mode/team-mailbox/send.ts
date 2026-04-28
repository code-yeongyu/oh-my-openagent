import { Buffer } from "node:buffer"
import { mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { loadRuntimeState } from "../team-state-store/store"
import { atomicWrite, withLock } from "../team-state-store/locks"
import type { Message } from "../types"

type SendContext = {
  isLead: boolean
  activeMembers: string[]
  reservedRecipients?: ReadonlySet<string>
}

export class BroadcastNotPermittedError extends Error {
  constructor(message = "broadcast requires lead role") {
    super(message)
    this.name = "BroadcastNotPermittedError"
  }
}

export class PayloadTooLargeError extends Error {
  constructor(message = "payload exceeds 32 KB") {
    super(message)
    this.name = "PayloadTooLargeError"
  }
}

export class RecipientBackpressureError extends Error {
  constructor(message = "recipient inbox full (backpressure)") {
    super(message)
    this.name = "RecipientBackpressureError"
  }
}

export class DuplicateMessageIdError extends Error {
  constructor(message = "duplicate message id") {
    super(message)
    this.name = "DuplicateMessageIdError"
  }
}

export class TeamDeletingError extends Error {
  constructor(message = "team is deleting") {
    super(message)
    this.name = "TeamDeletingError"
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT"
}

async function assertTeamAcceptsMessages(teamRunId: string, config: TeamModeConfig): Promise<void> {
  try {
    const runtimeState = await loadRuntimeState(teamRunId, config)
    if (runtimeState.status === "deleting" || runtimeState.status === "deleted") {
      throw new TeamDeletingError()
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return
    }

    throw error
  }
}

function resolveRecipients(message: Message, context: SendContext): string[] {
  if (message.to !== "*") {
    return [message.to]
  }

  return [...new Set(context.activeMembers)]
}

async function getUnreadSizeBytes(inboxDir: string): Promise<number> {
  try {
    const directoryEntries = await readdir(inboxDir, { withFileTypes: true })
    const unreadEntries = directoryEntries.filter((entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) return false
      if (entry.name.startsWith(".delivering-")) return true
      return !entry.name.startsWith(".")
    })

    const sizes = await Promise.all(unreadEntries.map(async (entry) => {
      const fileStats = await stat(path.join(inboxDir, entry.name))
      return fileStats.size
    }))

    return sizes.reduce((totalBytes, fileSize) => totalBytes + fileSize, 0)
  } catch (error) {
    if (isMissingPathError(error)) {
      return 0
    }

    throw error
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (isMissingPathError(error)) {
      return false
    }

    throw error
  }
}

export async function sendMessage(
  message: Message,
  teamRunId: string,
  config: TeamModeConfig,
  context: SendContext,
): Promise<{ messageId: string; deliveredTo: string[] }> {
  const serializedMessage = `${JSON.stringify(message, null, 2)}\n`
  const serializedMessageBytes = Buffer.byteLength(serializedMessage, "utf8")
  const payloadBytes = Buffer.byteLength(message.body, "utf8")
  if (payloadBytes > config.message_payload_max_bytes) {
    throw new PayloadTooLargeError()
  }

  await assertTeamAcceptsMessages(teamRunId, config)

  if (message.to === "*" && !context.isLead) {
    throw new BroadcastNotPermittedError()
  }

  const baseDir = resolveBaseDir(config)
  const deliveredTo: string[] = []
  const reservedRecipients = context.reservedRecipients ?? new Set<string>()

  for (const recipient of resolveRecipients(message, context)) {
    const inboxDir = getInboxDir(baseDir, teamRunId, recipient)
    await mkdir(inboxDir, { recursive: true, mode: 0o700 })

    await withLock(`${inboxDir}.lock`, async () => {
      const unreadSizeBytes = await getUnreadSizeBytes(inboxDir)
      const nextUnreadSizeBytes = unreadSizeBytes + serializedMessageBytes
      if (nextUnreadSizeBytes > config.recipient_unread_max_bytes) {
        throw new RecipientBackpressureError()
      }

      const unreservedPath = path.join(inboxDir, `${message.messageId}.json`)
      const reservedPath = path.join(inboxDir, `.delivering-${message.messageId}.json`)
      if (await fileExists(unreservedPath) || await fileExists(reservedPath)) {
        throw new DuplicateMessageIdError()
      }

      const targetPath = reservedRecipients.has(recipient) ? reservedPath : unreservedPath
      await atomicWrite(targetPath, serializedMessage)
      deliveredTo.push(recipient)
    }, { ownerTag: `team-mailbox:${recipient}` })
  }

  return { messageId: message.messageId, deliveredTo }
}
