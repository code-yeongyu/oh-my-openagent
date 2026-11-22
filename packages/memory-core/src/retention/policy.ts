import { join } from "node:path"

import { lstat, readdir } from "../fs/resilient"
import type { MemoryIdentityPaths } from "../identity/layout"
import type { PassBudget } from "./budget"

export const DAY_MS = 24 * 60 * 60 * 1000

/** Windows in days; `memory.runtime.*` in omo.json, per-agent overridable. */
export interface RuntimeRetentionPolicy {
  /** Folded reflection runs, fully-reflected transcripts, idle sidecars, legacy stores. */
  readonly retentionDays: number
  /** Never- and partly-reflected transcript journals, when `discardUnreflectedJournals` is on. */
  readonly abandonedJournalDays: number
  /** Off (the default) keeps every journal reflection never folded into memory; on is health-gated. */
  readonly discardUnreflectedJournals: boolean
  /** Consumed completion records and recall ledgers. */
  readonly completionsDays: number
  /** Wall-clock budget of one pass per identity; an interrupted pass resumes from its cursor. */
  readonly passBudgetMs: number
}

export const DEFAULT_RUNTIME_RETENTION: RuntimeRetentionPolicy = {
  retentionDays: 7,
  abandonedJournalDays: 14,
  discardUnreflectedJournals: false,
  completionsDays: 30,
  passBudgetMs: 60_000,
}

export type RetentionKeepReason =
  | "anchor"
  | "locked"
  | "live"
  | "malformed"
  | "newest"
  | "no-mark"
  | "no-terminal"
  | "owned"
  | "pending-compaction"
  | "pending-delivery"
  | "pruned"
  | "recent"
  | "reserved"
  | "run-present"
  | "state-unreadable"
  | "unfolded-terminal"
  | "unclassified"
  | "scheduler-busy"
  | "claim-failed"
  | "reflection-unhealthy"
  | "unreflected-retention-off"
  | "changed-during-removal"
  | "state-behind-transcript"

export interface RetentionStoreResult {
  readonly removed: readonly string[]
  readonly kept: Readonly<Record<string, RetentionKeepReason>>
}

export interface RetentionContext {
  readonly paths: MemoryIdentityPaths
  readonly policy: RuntimeRetentionPolicy
  readonly now: () => number
  readonly isLiveSession?: (sessionId: string) => boolean
  /** `memory.reflection.enabled` for the identity; the CLI and the host sweep pass true. */
  readonly reflectionEnabled?: boolean
  readonly signal?: AbortSignal
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
  /** Observed before every claim rename; throwing refuses that claim (platform refusals in tests). */
  readonly beforeClaimRename?: (from: string, to: string) => Promise<void>
  /** Set by the pass: bounds the walk and records the resume point. */
  readonly budget?: PassBudget
  /** Observed between a journal's lock-free selection and its claim under `state.lock`. */
  readonly beforeJournalClaim?: (sessionId: string) => Promise<void>
  /** Observed after a claim's lock is released and before its tombstone is deleted. */
  readonly beforeTombstoneDelete?: (tombstone: string) => Promise<void>
}

export class StoreTally {
  readonly removed: string[] = []
  readonly kept: Record<string, RetentionKeepReason> = {}

  keep(name: string, reason: RetentionKeepReason): void {
    this.kept[name] = reason
  }

  result(): RetentionStoreResult {
    return { removed: [...this.removed].sort(), kept: { ...this.kept } }
  }
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function listNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).sort()
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return []
    throw error
  }
}

/** Newest mtime of the path and everything under it; symlinks count as themselves. */
export async function newestMtime(path: string): Promise<number | undefined> {
  const stats = await lstat(path).catch(() => undefined)
  if (stats === undefined) return undefined
  let newest = stats.mtimeMs
  if (!stats.isDirectory()) return newest
  for (const name of await listNames(path)) {
    const inner = await newestMtime(join(path, name))
    if (inner !== undefined && inner > newest) newest = inner
  }
  return newest
}

export async function idleSince(path: string, cutoffMs: number): Promise<boolean> {
  const newest = await newestMtime(path)
  return newest !== undefined && newest <= cutoffMs
}
