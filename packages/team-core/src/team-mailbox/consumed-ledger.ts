import { stat } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export async function isMessageConsumed(
  teamRunId: string,
  recipient: string,
  messageId: string,
  config: TeamModeConfig,
): Promise<boolean> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, recipient)
  const processedPath = path.join(inboxDir, "processed", `${messageId}.json`)

  try {
    await stat(processedPath)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}
