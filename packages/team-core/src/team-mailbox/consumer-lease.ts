import { AsyncLocalStorage } from "node:async_hooks"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { withLock } from "../team-state-store/locks"
import { InboxLeaseOwnership } from "./lease-ownership"

type InboxConsumerLeaseOptions = {
  readonly staleAfterMs: number
}

export const DEAD_CONSUMER_LEASE_STALE_MS = 0

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
): Promise<T> {
  await mkdir(inboxDir, { recursive: true, mode: 0o700 })
  const leasePath = path.join(inboxDir, ".consumer.lock")
  const currentLeases = heldInboxLeases.getStore()
  const nestedRun = currentLeases?.get(leasePath)?.tryRun(fn) ?? null
  if (nestedRun !== null) return await nestedRun

  return withLock(leasePath, async () => {
    const ownership = new InboxLeaseOwnership()
    const leases = new Map(currentLeases ?? [])
    leases.set(leasePath, ownership)
    try {
      return await heldInboxLeases.run(leases, fn)
    } finally {
      await ownership.closeAndDrain()
    }
  }, {
    ownerTag: `team-mailbox-consumer:${recipient}`,
    staleAfterMs: options.staleAfterMs,
  })
}
