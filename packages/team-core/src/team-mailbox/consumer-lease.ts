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

type InboxLeaseScope = {
  active: boolean
}

type HeldInboxLease = {
  readonly ownership: InboxLeaseOwnership
  readonly scope: InboxLeaseScope
}

export const DEAD_CONSUMER_LEASE_STALE_MS = 0

const heldInboxLeases = new AsyncLocalStorage<ReadonlyMap<string, HeldInboxLease>>()

function isActiveLeaseContext(
  leases: ReadonlyMap<string, HeldInboxLease> | undefined,
): leases is ReadonlyMap<string, HeldInboxLease> {
  if (leases === undefined) return false
  for (const { scope } of leases.values()) {
    if (!scope.active) return false
  }
  return true
}

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
  const leasePath = path.join(inboxDir, ".consumer.lock")
  const inheritedLeases = heldInboxLeases.getStore()
  const currentLeases = isActiveLeaseContext(inheritedLeases)
    ? inheritedLeases
    : undefined
  const currentLease = currentLeases?.get(leasePath)
  if (currentLease !== undefined) {
    const childScope: InboxLeaseScope = { active: true }
    const childLeases = new Map(currentLeases)
    childLeases.set(leasePath, { ownership: currentLease.ownership, scope: childScope })
    const nestedRun = currentLease.ownership.tryRun(currentLease.scope.active, async () => {
      try {
        return await heldInboxLeases.run(childLeases, fn)
      } finally {
        childScope.active = false
      }
    })
    if (nestedRun !== null) return await nestedRun
  }

  await mkdir(inboxDir, { recursive: true, mode: 0o700 })

  return withLock(leasePath, async () => {
    const ownership = new InboxLeaseOwnership()
    const scope: InboxLeaseScope = { active: true }
    const leases = new Map(isActiveLeaseContext(currentLeases) ? currentLeases : [])
    leases.set(leasePath, { ownership, scope })
    try {
      return await heldInboxLeases.run(leases, fn)
    } finally {
      scope.active = false
      await ownership.closeAndDrain()
    }
  }, {
    ownerTag: `team-mailbox-consumer:${recipient}`,
    staleAfterMs: options.staleAfterMs,
  })
}
