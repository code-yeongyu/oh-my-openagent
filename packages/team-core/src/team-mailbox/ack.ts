import { mkdir, rename } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
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
    const sourcePaths = [
      path.join(inboxDir, messageFileName),
      path.join(inboxDir, `.delivering-${messageFileName}`),
    ]
    const targetPath = path.join(processedDir, messageFileName)

    for (const sourcePath of sourcePaths) {
      try {
        await rename(sourcePath, targetPath)
        break
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === "ENOENT") {
          continue
        }

        throw error
      }
    }
  }
}
