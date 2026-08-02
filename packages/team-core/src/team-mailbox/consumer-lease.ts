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

type InboxLeaseContext = {
  readonly leases: ReadonlyMap<string, HeldInboxLease>
  readonly leafScope: InboxLeaseScope
}

export const DEAD_CONSUMER_LEASE_STALE_MS = 0

const heldInboxLeases = new AsyncLocalStorage<InboxLeaseContext>()

function isActiveLeaseContext(
  context: InboxLeaseContext | undefined,
): context is InboxLeaseContext {
  return context?.leafScope.active === true
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
  const inheritedContext = heldInboxLeases.getStore()
  const currentContext = isActiveLeaseContext(inheritedContext)
    ? inheritedContext
    : undefined
  const currentLease = currentContext?.leases.get(leasePath)
  let resetInheritedContext = inheritedContext !== undefined && currentContext === undefined
  if (currentContext !== undefined && currentLease !== undefined) {
    const childScope: InboxLeaseScope = { active: true }
    const childLeases = new Map(currentContext.leases)
    childLeases.set(leasePath, { ownership: currentLease.ownership, scope: childScope })
    const nestedRun = currentLease.ownership.tryRun(
      currentContext.leafScope.active && currentLease.scope.active,
      async () => {
        try {
          return await heldInboxLeases.run({ leases: childLeases, leafScope: childScope }, fn)
        } finally {
          childScope.active = false
        }
      },
    )
    if (nestedRun !== null) return await nestedRun
    resetInheritedContext = true
  }

  await mkdir(inboxDir, { recursive: true, mode: 0o700 })

  return withLock(leasePath, async () => {
    const ownership = new InboxLeaseOwnership()
    const scope: InboxLeaseScope = { active: true }
    const parentContext = !resetInheritedContext && isActiveLeaseContext(currentContext)
      ? currentContext
      : undefined
    const leases = new Map(parentContext?.leases ?? [])
    leases.set(leasePath, { ownership, scope })
    try {
      return await heldInboxLeases.run({ leases, leafScope: scope }, fn)
    } finally {
      scope.active = false
      await ownership.closeAndDrain()
    }
  }, {
    ownerTag: `team-mailbox-consumer:${recipient}`,
    staleAfterMs: options.staleAfterMs,
  })
}
