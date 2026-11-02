import { getProcessStartIdentity, startIdentitiesConflict } from "@oh-my-opencode/memory-core/process-identity"

import type { TaskRecord } from "../state"

/** The OS's own record of when the process now holding `pid` started, or null when it cannot say. */
export type ProcessStartReader = (pid: number) => Promise<string | null>

/**
 * A record's host_pid names the process that claimed it, but a bare pid probe cannot tell that
 * process from a later one the OS gave the same pid. The claimant stamps `host_claim` with its own
 * start identity, so a process now under that pid with a different identity is never its owner.
 * Identities come from one reader on both sides and are compared as values, never as clock times:
 * a wall-clock step between the stamp and the check must not make a live owner look like a newcomer.
 */
export type OwnerProcessView = {
  observe(pid: number): Promise<void>
  startDiffers(pid: number, claimedStart: string): boolean
}

export const readProcessStartIdentity: ProcessStartReader = async (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  return await getProcessStartIdentity(pid)
}

// An observation is evidence only for the check it was taken for. Callers that check without observing
// (TTL retention) must not be judged against an identity read long ago, so they keep the owner.
const OBSERVATION_FRESH_MS = 5_000

export function createOwnerProcessView(read: ProcessStartReader, now: () => number = () => performance.now()): OwnerProcessView {
  // An identity has no order: an entry left from an earlier holder of the pid would contradict every
  // later owner's stamp. So a failed read clears the entry, and an old one is not evidence.
  const starts = new Map<number, { readonly start: string; readonly at: number }>()
  return {
    async observe(pid) {
      const start = await read(pid).catch(() => null)
      if (start === null) starts.delete(pid)
      else starts.set(pid, { start, at: now() })
    },
    startDiffers(pid, claimedStart) {
      const seen = starts.get(pid)
      if (seen === undefined || now() - seen.at > OBSERVATION_FRESH_MS) return false
      return startIdentitiesConflict(claimedStart, seen.start)
    },
  }
}

const defaultOwnerProcessView: OwnerProcessView = createOwnerProcessView(readProcessStartIdentity)

// An injected liveness probe answers for pids that are not real processes here; real start times would
// contradict it, so such a caller learns nothing from the OS unless it injects its own view too.
const NO_START_EVIDENCE: OwnerProcessView = { observe: async () => undefined, startDiffers: () => false }

export function ownerProcessViewFor(injectedLiveness: unknown, injectedView: OwnerProcessView | undefined): OwnerProcessView {
  return injectedView ?? (injectedLiveness === undefined ? defaultOwnerProcessView : NO_START_EVIDENCE)
}

/**
 * True only while the process that claimed `record` can still be running under its host_pid. Without
 * the owner's own stamp for that pid there is no evidence against a live pid, so it stays the owner.
 */
export function recordOwnerAlive(isAlive: (pid: number) => boolean, view: OwnerProcessView, record: TaskRecord): boolean {
  const pid = record.host_pid
  if (pid === undefined || !isAlive(pid)) return false
  const claim = record.host_claim
  if (claim?.pid !== pid || claim.start === undefined) return true
  return !view.startDiffers(pid, claim.start)
}

// Only a foreign owner's own stamp can be contradicted, and this process can never be a reused pid.
// Undefined when nothing needs probing, so callers add no scheduling turn on the common path.
export function observeRecordOwners(view: OwnerProcessView, records: readonly TaskRecord[], ownPid: number): Promise<void> | undefined {
  const pids = new Set<number>()
  for (const record of records) {
    const pid = record.host_pid
    if (pid === undefined || pid === ownPid || pid === process.pid || record.host_claim?.pid !== pid || record.host_claim.start === undefined) continue
    pids.add(pid)
  }
  if (pids.size === 0) return undefined
  return Promise.all([...pids].map((pid) => view.observe(pid))).then(() => undefined)
}
