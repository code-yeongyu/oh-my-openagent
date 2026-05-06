import { mkdir, rename } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"

export async function ackMessages(
  teamRunId: string,
  memberName: string,
  messageIds: string[],
  config: TeamModeConfig,
): Promise<void> {
  const baseDir = resolveBaseDir(config)
  const inboxDir = getInboxDir(baseDir, teamRunId, memberName)
  const processedDir = path.join(inboxDir, "processed")
  await mkdir(processedDir, { recursive: true, mode: 0o700 })

  for (const messageId of messageIds) {
    const messageFileName = `${messageId}.json`
    const sourcePath = path.join(inboxDir, messageFileName)
    const targetPath = path.join(processedDir, messageFileName)

    try {
      await rename(sourcePath, targetPath)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === "ENOENT") {
        continue
      }

      throw error
    }
  }
}
