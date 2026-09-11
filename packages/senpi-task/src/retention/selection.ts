import { createHash } from "node:crypto"
import { resolve, sep } from "node:path"

import type { OmoTaskTranscriptRetention } from "@oh-my-opencode/omo-config-core"

import { isSpawnSpecV1, type TaskRecord } from "../state"

// Outcome classes for retention: a failed/cancelled/interrupted/lost run is ALWAYS kept once
// selected (the audit value of a failure is highest and they are rare), while successful runs go
// through the deterministic sample so the archive stays bounded.
const NON_SUCCESS_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["error", "cancelled", "interrupted", "lost"])

export type TranscriptRetentionMode = "full" | "metadata"

export type TranscriptRetentionSelection = {
  readonly reason: "explicit" | "category"
  // Which parts of the run are retained: the compressed visible transcript plus its manifest,
  // or the metadata manifest only (protected work: an audit trail without sensitive content).
  readonly mode: TranscriptRetentionMode
  readonly sample_retained: boolean
  // True when a metadata_only_paths entry (not the task's own mark) downgraded a would-be-full
  // archive to metadata-only, so audits can distinguish caller intent from policy.
  readonly protected_by_path: boolean
}

// Decide whether a terminal task's transcript is archived, and at which fidelity. Selection
// requires the user-level opt-in (`enabled`); a task then opts in explicitly via its durable
// `retain_transcript` mark (true = full, "metadata" = manifest only) or implicitly by matching a
// listed category. `retain_transcript: false` always excludes - that is the lever a task uses to
// stay out of the archive entirely. A selected task whose spawn cwd sits inside a
// `metadata_only_paths` entry is downgraded to metadata-only: protected trees (e.g. clinical
// repositories) never contribute transcript content even when a category rule selected them.
export function selectForTranscriptRetention(
  settings: OmoTaskTranscriptRetention | undefined,
  record: TaskRecord,
): TranscriptRetentionSelection | undefined {
  if (settings?.enabled !== true) return undefined
  if (record.retain_transcript === false) return undefined

  const failed = NON_SUCCESS_TERMINAL_STATUSES.has(record.status)

  // An explicit per-task mark is the caller's direct retention request: the success sample never
  // drops it, and the mark picks the fidelity (true = full, "metadata" = manifest only).
  if (record.retain_transcript === true) return { reason: "explicit", mode: "full", sample_retained: true, protected_by_path: false }
  if (record.retain_transcript === "metadata") return { reason: "explicit", mode: "metadata", sample_retained: true, protected_by_path: false }

  const category = record.category ?? undefined
  if (category === undefined || !settings.categories.includes(category)) return undefined
  if (!failed && !retainsSuccessSample(settings, record.task_id)) return undefined
  const protectedByPath = isProtectedCwd(settings, record)
  return { reason: "category", mode: protectedByPath ? "metadata" : "full", sample_retained: true, protected_by_path: protectedByPath }
}

// Deterministic per-task bucketing: sha256(task_id) % denominator === 0. Stable across processes
// and sweeps, so a completed run's retention never depends on when cleanup happens to run.
function retainsSuccessSample(settings: OmoTaskTranscriptRetention, taskId: string): boolean {
  const bucket = createHash("sha256").update(taskId).digest()[0] % settings.success_sample_denominator
  return bucket === 0
}

// A cwd is protected when it equals, or sits underneath, any configured metadata_only_paths root
// (segment-wise prefix, so /clinic never matches /clinic-other). Protection only ever DOWNGRADES
// retention: it never selects a task the mark/category rules did not already keep.
function isProtectedCwd(settings: OmoTaskTranscriptRetention, record: TaskRecord): boolean {
  const cwd = spawnCwd(record)
  if (cwd === undefined) return false
  const resolvedCwd = resolve(cwd)
  for (const entry of settings.metadata_only_paths) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue
    const root = resolve(trimmed)
    if (resolvedCwd === root || resolvedCwd.startsWith(root + sep)) return true
  }
  return false
}

function spawnCwd(record: TaskRecord): string | undefined {
  const spec = record.spawn_spec
  return spec !== undefined && isSpawnSpecV1(spec) ? spec.cwd : undefined
}
