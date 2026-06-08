import type { Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { MessageSchema } from "../types"
import type { Message } from "../types"

function isInboxMessageFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".")
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function readInboxMessage(
  inboxDir: string,
  fileName: string,
  memberName: string,
  teamRunId: string,
): Promise<Message | null> {
  const filePath = path.join(inboxDir, fileName)
  const messageContext = { memberName, teamRunId, fileName }

  try {
    const fileContent = await readFile(filePath, "utf8")
    const parsedMessage = MessageSchema.safeParse(JSON.parse(fileContent))
    if (!parsedMessage.success) {
      log("team mailbox skipped malformed message", {
        event: "team-mailbox-malformed-message",
        ...messageContext,
        issues: parsedMessage.error.issues,
      })
      return null
    }

    return parsedMessage.data
  } catch (error) {
    log("team mailbox skipped unreadable message", {
      event: "team-mailbox-unreadable-message",
      ...messageContext,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function listUnreadMessages(
  teamRunId: string,
  memberName: string,
  config: TeamModeConfig,
): Promise<Message[]> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, memberName)

  try {
    const directoryEntries = await readdir(inboxDir, { withFileTypes: true })
    const unreadMessages = await Promise.all(
      directoryEntries
        .filter(isInboxMessageFile)
        .map((entry) => readInboxMessage(inboxDir, entry.name, memberName, teamRunId)),
    )

    return unreadMessages
      .filter((message): message is Message => message !== null)
      .sort((leftMessage, rightMessage) => leftMessage.timestamp - rightMessage.timestamp)
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return []
    }

    throw error
  }
}
