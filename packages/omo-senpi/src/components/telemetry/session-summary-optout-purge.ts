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
}): void {
  const dir = summaryDir(input.stateDir)
  const self = currentProcessOwner()
  const isPidAlive = input.isPidAlive ?? processIsAlive
  const registry = createOwnerRegistry({ dir, owner: self, isPidAlive })
  const storage = createSummaryStorage({ stateDir: input.stateDir, owner: self, isPidAlive })
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

  for (const key of storage.windowKeys()) {
    const record = storage.readWindow(key)
    if (record === undefined) continue
    if (record === CORRUPT || (!registry.isAlive(record.owner) && !sendable(record))) storage.removeWindow(key)
  }

  for (const uuid of storage.pendingUuids()) {
    const record = storage.readPending(uuid)
    if (record === undefined) continue
    if (record === CORRUPT || (!registry.isAlive(record.owner) && !sendable(record))) storage.removePending(uuid)
  }

  for (const name of listNames(join(dir, "owners"))) {
    const owner = parseOwner(readJsonOrCorrupt(join(dir, "owners", name)))
    if (owner !== undefined && owner.pid !== self.pid) registry.isAlive(owner)
  }
}
