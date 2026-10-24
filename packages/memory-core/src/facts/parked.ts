// The caller owns facts-queue.lock. Only filenames are inspected: a legacy parked
// backlog must leave the hot directory without reading or parsing its payloads.
import { mkdir, readFile, readdir, rename } from "../fs/resilient"
import { join } from "node:path"

import { FactsFailuresCorruptError, parseFailuresFile, type FactsFailureRecord } from "./failures-schema"
import { queueEntrySuffix, type FactsQueueLayout } from "./schema"

const migrated = new Set<string>()

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined
}

export async function moveParkedEntries(
  layout: FactsQueueLayout,
  records: readonly FactsFailureRecord[],
  restore = false,
): Promise<number> {
  const suffixes = new Set(records.filter((record) => record.state === "parked")
    .map((record) => queueEntrySuffix(record.conversationId, record.end_message_id)))
  if (suffixes.size === 0) return 0
  const source = restore ? layout.parkedDir : layout.queueDir
  const target = restore ? layout.queueDir : layout.parkedDir
  const names = await readdir(source).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return []
    throw error
  })
  let moved = 0
  for (const name of names) {
    // Timestamp (19 characters) + the same hash pair entryPath uses.
    if (!/^\d{8}T\d{9}Z-[a-f0-9]{12}-[a-f0-9]{8}\.json$/.test(name)) continue
    if (!suffixes.has(name.slice(19))) continue
    if (moved === 0) await mkdir(target, { recursive: true })
    await rename(join(source, name), join(target, name))
    moved += 1
  }
  return moved
}

/** Once per identity per process; mark only after all renames have succeeded. */
export async function migrateParkedEntries(layout: FactsQueueLayout): Promise<void> {
  if (migrated.has(layout.queueDir)) return
  const raw = await readFile(layout.failuresPath, "utf8").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  })
  if (raw !== undefined) {
    let records
    try {
      records = parseFailuresFile(raw).entries
    } catch (error) {
      // Keep unreadable-ledger reporting at the failure reader/launch gate. No
      // movement is safe until that ledger is repaired; retry migration then.
      if (error instanceof FactsFailuresCorruptError) return
      throw error
    }
    await moveParkedEntries(layout, records)
  }
  migrated.add(layout.queueDir)
}
