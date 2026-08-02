import { AsyncLocalStorage } from "node:async_hooks"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { withLock } from "../team-state-store/locks"

type InboxConsumerLeaseOptions = {
  readonly staleAfterMs: number
}

type InboxConsumerLeaseObserver = {
  readonly beforeOwnershipCheck?: () => void
}

export const DEAD_CONSUMER_LEASE_STALE_MS = 0

type InboxLeaseOwnership = {
  active: boolean
}

const heldInboxLeases = new AsyncLocalStorage<ReadonlyMap<string, InboxLeaseOwnership>>()

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
  observer: InboxConsumerLeaseObserver = {},
): Promise<T> {
  await mkdir(inboxDir, { recursive: true, mode: 0o700 })
  const leasePath = path.join(inboxDir, ".consumer.lock")
  const currentLeases = heldInboxLeases.getStore()
  observer.beforeOwnershipCheck?.()
  if (currentLeases?.get(leasePath)?.active === true) {
    return await fn()
  }

  return withLock(leasePath, async () => {
    const ownership: InboxLeaseOwnership = { active: true }
    const leases = new Map(currentLeases ?? [])
    leases.set(leasePath, ownership)
    try {
      return await heldInboxLeases.run(leases, fn)
    } finally {
      ownership.active = false
    }
  }, {
    ownerTag: `team-mailbox-consumer:${recipient}`,
    staleAfterMs: options.staleAfterMs,
  })
}
