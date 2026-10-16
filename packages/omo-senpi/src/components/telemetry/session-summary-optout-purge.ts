import { linkSync } from "node:fs"
import { join } from "node:path"

import { CORRUPT, listNames, readJsonOrCorrupt, removeFile } from "./session-summary-files"
import { createOwnerRegistry, currentProcessOwner, parseOwner, processIsAlive } from "./session-summary-owner"
import {
  createSummaryStorage,
  isRecordSendable,
  parsePendingRecord,
  parseWindowRecord,
  summaryDir,
  type ConsentScope,
  type PendingRecord,
  type ReadResult,
  type SummaryStorage,
  type WindowRecord,
} from "./session-summary-storage"

/**
 * Run by an opted-out process at startup and shutdown. Every record a DEAD owner left that may not be sent
 * now (no `enabled` mark, or its scope is opted out) is deleted: windows, pending events, claims and temps,
 * and dead owners' registry entries. Files of live owners are theirs: each re-checks its own consent. Nothing
 * here registers this process as an owner or writes a file.
 */
export function purgeOptedOutQueue(input: {
  readonly stateDir: string
  readonly isScopeConsented: (scope: ConsentScope) => boolean
  readonly isPidAlive?: (pid: number) => boolean
  /** The queue to purge; defaults to the one under `stateDir`. Injected by tests that interleave a live writer. */
  readonly storage?: SummaryStorage
}): void {
  const dir = summaryDir(input.stateDir)
  const self = currentProcessOwner()
  const isPidAlive = input.isPidAlive ?? processIsAlive
  const registry = createOwnerRegistry({ dir, owner: self, isPidAlive })
  const storage = input.storage ?? createSummaryStorage({ stateDir: input.stateDir, owner: self, isPidAlive })
  const sendable = (record: Parameters<typeof isRecordSendable>[0]) => isRecordSendable(record, input.isScopeConsented)

  for (const leftover of storage.leftovers()) {
    if (registry.isAlive(leftover.owner)) continue
    const value = readJsonOrCorrupt(leftover.path)
    const record = value === undefined || value === CORRUPT
      ? undefined
      : leftover.kind === "pending-claim" ? parsePendingRecord(value) : parseWindowRecord(value)
    if (leftover.kind !== "temp" && record !== undefined && sendable(record)) continue
    removeFile(leftover.path)
  }

  // A record a live owner holds, or one that may still be sent, is kept. The decision is re-made on the copy the
  // claim (an atomic rename) actually took, so a live writer's rewrite between the read and the delete survives.
  const kept = (record: ReadResult<WindowRecord | PendingRecord>): boolean =>
    record !== undefined && record !== CORRUPT && (registry.isAlive(record.owner) || sendable(record))

  for (const key of storage.windowKeys()) {
    const record = storage.readWindow(key)
    if (record === undefined || kept(record)) continue
    const claimed = storage.claimWindow(key)
    if (claimed !== undefined) settleClaim(claimed.claimPath, kept(claimed.record))
  }

  for (const uuid of storage.pendingUuids()) {
    const record = storage.readPending(uuid)
    if (record === undefined || kept(record)) continue
    const claimed = storage.claimPending(uuid)
    if (claimed !== undefined) settleClaim(claimed.claimPath, kept(claimed.record))
  }

  for (const name of listNames(join(dir, "owners"))) {
    const owner = parseOwner(readJsonOrCorrupt(join(dir, "owners", name)))
    if (owner !== undefined && owner.pid !== self.pid) registry.isAlive(owner)
  }
}

// Hands a kept record back without ever replacing a newer file at its name (exclusive link), else deletes it.
function settleClaim(claimPath: string, keep: boolean): void {
  if (keep) {
    try {
      linkSync(claimPath, claimPath.slice(0, claimPath.lastIndexOf(".claimed-")))
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    }
  }
  removeFile(claimPath)
}
