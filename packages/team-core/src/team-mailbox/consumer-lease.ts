import { AsyncLocalStorage } from "node:async_hooks"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { withLock } from "../team-state-store/locks"

type InboxConsumerLeaseOptions = {
  readonly staleAfterMs: number
}

export const DEAD_CONSUMER_LEASE_STALE_MS = 0

const heldInboxLeases = new AsyncLocalStorage<ReadonlySet<string>>()

export async function withInboxConsumerLease<T>(
  teamRunId: string,
  recipient: string,
  config: TeamModeConfig,
  fn: () => Promise<T>,
  options: InboxConsumerLeaseOptions,
): Promise<T> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, recipient)
  return await withInboxConsumerLeaseAtPath(inboxDir, recipient, fn, options)
}

export async function withInboxConsumerLeaseAtPath<T>(
  inboxDir: string,
  recipient: string,
  fn: () => Promise<T>,
  options: InboxConsumerLeaseOptions,
): Promise<T> {
  await mkdir(inboxDir, { recursive: true, mode: 0o700 })
  const leasePath = path.join(inboxDir, ".consumer.lock")
  const currentLeases = heldInboxLeases.getStore()
  if (currentLeases?.has(leasePath) === true) {
    return await fn()
  }

  return withLock(leasePath, async () => await heldInboxLeases.run(
    new Set([...(currentLeases ?? []), leasePath]),
    fn,
  ), {
    ownerTag: `team-mailbox-consumer:${recipient}`,
    staleAfterMs: options.staleAfterMs,
  })
}
