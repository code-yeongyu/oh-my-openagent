// Plain-words classification of facts failures for the /doctor and /facts surfaces.
//
// The ledger stores a machine reason; the reader needs the one action to take. A transient
// cause (a timeout, a busy write lock) means the remedy is /facts retry itself. A cause
// only the user can fix (no model for the extractor, secret-like content) must name what
// to fix instead of telling her to "fix the cause".

import type { FactsFailureRecord, FactsFailureReason } from "@oh-my-opencode/memory-core"
import { existsSync, readdirSync, readFileSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { childFailureCause } from "../worker/failure-detail"

export interface FactsFailureCause {
  /** Short plain-words label; undefined when the cause is not known. */
  readonly label?: string
  /** "retry" when retrying is the action; "fix-first" when the user must change something. */
  readonly action: "retry" | "fix-first"
  /** The config setting to name when the fix is a setting. */
  readonly setting?: string
}

const CAUSES: Record<Exclude<FactsFailureReason, "child_exit" | "other">, FactsFailureCause> = {
  deadline_exceeded: { label: "timeout", action: "retry" },
  memory_write_lock_exhausted: { label: "the memory write lock stayed busy", action: "retry" },
  unknown_liveness: { label: "the facts child stopped responding", action: "retry" },
  quick_category_unavailable: {
    label: "no model is available for facts extraction",
    action: "fix-first",
    setting: "memory.facts.model",
  },
  invalid_extraction: { label: "parse error", action: "fix-first" },
  payload_entry_oversize: { label: "one entry is too large to extract", action: "fix-first" },
  payload_envelope_oversize: { label: "the batch is too large to extract", action: "fix-first" },
  secret_like_content: { label: "secret-like content in the batch", action: "fix-first" },
  parent_dirty: { label: "the memory repository has uncommitted changes", action: "fix-first" },
}

function classifyFactsFailure(record: FactsFailureRecord): FactsFailureCause {
  if (record.lastReason === "other") return { action: "retry" }
  if (record.lastReason === "child_exit") {
    const detail = childFailureCause(record.lastDetail)
    return { label: detail ?? "the facts child exited", action: "fix-first" }
  }
  return CAUSES[record.lastReason]
}

function parkedOf(records: readonly FactsFailureRecord[]): readonly FactsFailureRecord[] {
  return records.filter((record) => record.state === "parked")
}

/** Label groups over parked records, most frequent first, label order breaking ties. */
function causeCounts(records: readonly FactsFailureRecord[]): readonly { cause: FactsFailureCause; count: number }[] {
  const byLabel = new Map<string, { cause: FactsFailureCause; count: number }>()
  for (const record of parkedOf(records)) {
    const cause = classifyFactsFailure(record)
    if (cause.label === undefined) continue
    const entry = byLabel.get(cause.label)
    if (entry === undefined) byLabel.set(cause.label, { cause, count: 1 })
    else entry.count += 1
  }
  return [...byLabel.values()].sort(
    (left, right) => right.count - left.count || (left.cause.label ?? "").localeCompare(right.cause.label ?? ""),
  )
}

/** The must-fix cause covering the most parked batches: the one the to-do names. */
export function dominantFixFirstCause(records: readonly FactsFailureRecord[]): FactsFailureCause | undefined {
  return causeCounts(records).find((entry) => entry.cause.action === "fix-first")?.cause
}

/**
 * The run directory of the newest parked batch whose run log still exists.
 *
 * The failure id is NOT the run directory name: it is the ledger's per-launch
 * `batchId` UUID (see `facts-terminal-writes.ts`), while a run directory is
 * `facts-<digest>-<attempt>`. So this looks the run up instead of joining the
 * id into a path: it scans each `<facts>/runs/<run>/ledger.json` for the ledger whose
 * `batchId` equals the record's `lastFailureId` and whose `runId` names its own
 * directory. A pruned run (no surviving ledger) yields no path, never a path
 * that does not exist; when the newest parked batch is pruned, the next newest
 * batch with a surviving run log is used. An unreadable runs directory also
 * yields no path, so a display failure can never invent a run log.
 */
export function parkedRunPath(records: readonly FactsFailureRecord[], factsDir: string | undefined): string | undefined {
  if (factsDir === undefined) return undefined
  const newestFirst = [...parkedOf(records)].sort(
    (left, right) => Date.parse(right.lastFailureAt) - Date.parse(left.lastFailureAt),
  )
  if (newestFirst.length === 0) return undefined
  const runsDir = join(factsDir, "runs")
  let names: string[]
  try {
    names = readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".prune-"))
      .map((entry) => entry.name)
  } catch {
    return undefined
  }
  const byBatchId = new Map<string, string>()
  for (const name of names.sort()) {
    const runDir = join(runsDir, name)
    let ledger: unknown
    try {
      ledger = JSON.parse(readFileSync(join(runDir, "ledger.json"), "utf8"))
    } catch {
      continue
    }
    if (ledger === null || typeof ledger !== "object" || Array.isArray(ledger)) continue
    const batchId = (ledger as Record<string, unknown>).batchId
    const runId = (ledger as Record<string, unknown>).runId
    if (typeof batchId !== "string" || batchId === "") continue
    if (runId !== undefined && runId !== name) continue
    if (!byBatchId.has(batchId)) byBatchId.set(batchId, runDir)
  }
  for (const record of newestFirst) {
    const runDir = byBatchId.get(record.lastFailureId.trim())
    if (runDir !== undefined && existsSync(runDir)) return runDir
  }
  return undefined
}

/**
 * The quieter segment after the to-do: cause counts over the parked batches plus the
 * newest parked batch's run path. An unknown cause contributes no label, never a guess,
 * but the run path still renders so the reader has somewhere to look.
 */
export function factsParkedCauseSummary(
  records: readonly FactsFailureRecord[],
  factsDir: string | undefined,
): string | undefined {
  if (parkedOf(records).length === 0) return undefined
  const segments: string[] = []
  const counts = causeCounts(records)
  if (counts.length > 0) {
    const list = counts.map((entry) => `${entry.cause.label} x${entry.count}`).join(", ")
    segments.push(`${counts.length === 1 ? "cause" : "causes"}: ${list}`)
  }
  const runPath = parkedRunPath(records, factsDir)
  if (runPath !== undefined) segments.push(`last run: ${runPath}`)
  return segments.length === 0 ? undefined : segments.join("; ")
}
