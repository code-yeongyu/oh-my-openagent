import { mkdir } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { withLock } from "../team-state-store/locks"

type InboxConsumerLeaseOptions = {
  readonly staleAfterMs: number
}

export async function withInboxConsumerLease<T>(
  teamRunId: string,
  recipient: string,
  config: TeamModeConfig,
  fn: () => Promise<T>,
  options: InboxConsumerLeaseOptions,
): Promise<T> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, recipient)
  await mkdir(inboxDir, { recursive: true, mode: 0o700 })

  return withLock(path.join(inboxDir, ".consumer.lock"), fn, {
    ownerTag: `team-mailbox-consumer:${recipient}`,
    staleAfterMs: options.staleAfterMs,
  })
}
