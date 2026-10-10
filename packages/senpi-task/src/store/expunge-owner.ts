import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"

import { withTaskRecordLock } from "./record-lock"
import type { ExpungeOwner } from "./types"

// The owner of a TTL tombstone lives beside it (`<taskId>.json.expunging.owner`), so every name the
// store lists or loads (`.json`, `.json.expunging`) stays exactly as it was.
export function expungeOwnerPath(tombstonePath: string): string {
  return `${tombstonePath}.owner`
}

function stagingPath(tombstonePath: string): string {
  return `${expungeOwnerPath(tombstonePath)}.tmp`
}

// Written beside and renamed over, so a crash mid-write never leaves a torn owner file. Every caller
// holds the record lock, so one fixed staging name cannot be shared by two writers.
export function writeExpungeOwner(tombstonePath: string, owner: ExpungeOwner): void {
  writeFileSync(stagingPath(tombstonePath), JSON.stringify(owner))
  renameSync(stagingPath(tombstonePath), expungeOwnerPath(tombstonePath))
}

/** Drop the owner file and any staging copy a crash left behind. */
export function removeExpungeOwner(tombstonePath: string): void {
  rmSync(expungeOwnerPath(tombstonePath), { force: true })
  rmSync(stagingPath(tombstonePath), { force: true })
}

export function readExpungeOwnerFile(tombstonePath: string): ExpungeOwner | undefined {
  const path = expungeOwnerPath(tombstonePath)
  if (!existsSync(path)) return undefined
  // An unreadable owner file (torn by an older non-atomic writer, or damaged) names nobody: the tombstone
  // is treated as abandoned rather than blocking every later recovery.
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const { pid, token } = parsed as { pid?: unknown; token?: unknown }
  return typeof pid === "number" && typeof token === "string" ? { pid, token } : undefined
}

function sameOwner(left: ExpungeOwner | undefined, right: ExpungeOwner | undefined): boolean {
  return left !== undefined && right !== undefined && left.pid === right.pid && left.token === right.token
}

// Each operation below runs under the record's lock, the same lock phase 1 tombstones under.

export function holdsTombstone(recordPath: string, tombstonePath: string, owner: ExpungeOwner): boolean {
  return withTaskRecordLock(recordPath, () => existsSync(tombstonePath) && sameOwner(readExpungeOwnerFile(tombstonePath), owner))
}

/** Put a tombstoned record back. True when it moved; never over a record that exists again. */
export function restoreTombstone(recordPath: string, tombstonePath: string, owner: ExpungeOwner | undefined): boolean {
  return withTaskRecordLock(recordPath, () => {
    if (!existsSync(tombstonePath) || existsSync(recordPath)) return false
    if (owner !== undefined && !sameOwner(readExpungeOwnerFile(tombstonePath), owner)) return false
    renameSync(tombstonePath, recordPath)
    removeExpungeOwner(tombstonePath)
    return true
  })
}

/** Hand a tombstone from `from` (undefined: written without an owner) to `to`; false when another owns it. */
export function takeOverTombstone(recordPath: string, tombstonePath: string, from: ExpungeOwner | undefined, to: ExpungeOwner): boolean {
  return withTaskRecordLock(recordPath, () => {
    if (!existsSync(tombstonePath)) return false
    const current = readExpungeOwnerFile(tombstonePath)
    if (current === undefined ? from !== undefined : !sameOwner(current, from)) return false
    writeExpungeOwner(tombstonePath, to)
    return true
  })
}
