import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  createLockRecord,
  skillsUsageLockPath,
  withLock,
  type LockRecord,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"

/** Skills-usage ledger entry: per skill-id, a read count and last-used timestamp. */
export interface SkillUsageEntry {
  readonly count: number
  readonly lastUsedAt: string
}

export type SkillsUsageLedger = Readonly<Record<string, SkillUsageEntry>>

export interface SkillsUsageLedgerPath {
  readonly ledgerPath: string
  readonly lockPath: string
}

const LOCK_WAIT_MS = 2000

export function skillsUsagePaths(identityPaths: MemoryIdentityPaths): SkillsUsageLedgerPath {
  return {
    ledgerPath: join(identityPaths.runtime, "skills-usage.json"),
    lockPath: skillsUsageLockPath(identityPaths.locks),
  }
}

/** Reads the ledger, returning an empty object when the file is absent or unreadable. */
export async function readSkillsUsageLedger(ledgerPath: string): Promise<SkillsUsageLedger> {
  try {
    return parseLedger(await readFile(ledgerPath, "utf8"))
  } catch {
    return {}
  }
}

/** Increments one skill under the identity-scoped lock. Never throws. */
export async function incrementSkillUsage(
  paths: SkillsUsageLedgerPath,
  skillId: string,
  now: () => Date,
  logger?: ComponentLogger,
): Promise<void> {
  const record = await createSkillsUsageLockRecord()
  try {
    await incrementSkillsUsageBatch(paths, new Map([[skillId, 1]]), now, record)
  } catch (error) {
    logger?.warn("skills-usage ledger write failed", { skillId, error: String(error) })
  }
}

export function createSkillsUsageLockRecord(): Promise<LockRecord> {
  return createLockRecord("skills-usage")
}

/** Merges a batch under the identity-scoped lock so concurrent sessions lose no increments. */
export async function incrementSkillsUsageBatch(
  paths: SkillsUsageLedgerPath,
  increments: ReadonlyMap<string, number>,
  now: () => Date,
  record: LockRecord,
  signal?: AbortSignal,
): Promise<void> {
  const isAborted = (): boolean => signal?.aborted === true
  await withLock(
    paths.lockPath,
    record,
    async () => {
      const current = await readSkillsUsageLedger(paths.ledgerPath)
      const timestamp = now().toISOString()
      const updated: Record<string, SkillUsageEntry> = { ...current }
      for (const [skillId, increment] of increments) {
        const entry = updated[skillId]
        updated[skillId] = {
          count: (entry?.count ?? 0) + increment,
          lastUsedAt: timestamp,
        }
      }
      if (isAborted()) return
      await mkdir(join(paths.ledgerPath, ".."), { recursive: true })
      if (isAborted()) return
      await writeLedgerAtomic(paths.ledgerPath, updated)
    },
    { waitTimeoutMs: LOCK_WAIT_MS },
  )
}

async function writeLedgerAtomic(ledgerPath: string, ledger: SkillsUsageLedger): Promise<void> {
  const tmp = `${ledgerPath}.tmp`
  await writeFile(tmp, JSON.stringify(ledger, null, 2), "utf8")
  await rename(tmp, ledgerPath)
}

function parseLedger(content: string): SkillsUsageLedger {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const result: Record<string, SkillUsageEntry> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    if (typeof entry.count !== "number" || typeof entry.lastUsedAt !== "string") continue
    result[key] = { count: entry.count, lastUsedAt: entry.lastUsedAt }
  }
  return result
}
