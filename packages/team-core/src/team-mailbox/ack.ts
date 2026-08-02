import { mkdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { DEAD_CONSUMER_LEASE_STALE_MS, withInboxConsumerLease } from "./consumer-lease"

export async function ackMessages(
  teamRunId: string,
  memberName: string,
  messageIds: string[],
  config: TeamModeConfig,
): Promise<void> {
  await withInboxConsumerLease(teamRunId, memberName, config, async () => {
    await ackMessagesUnderLease(teamRunId, memberName, messageIds, config)
  }, { staleAfterMs: DEAD_CONSUMER_LEASE_STALE_MS })
}

async function ackMessagesUnderLease(
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

    try {
      await stat(targetPath)
      await rm(path.join(inboxDir, `.reservation-${messageId}.generation`), { force: true })
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== "ENOENT") throw error
    }
  }
}
