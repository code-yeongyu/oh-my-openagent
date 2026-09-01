import { createHash } from "node:crypto"
import path from "node:path"

export const LOCK_DOMAINS = [
  "memory-write",
  "reflection-scheduler",
  "reflection-finalize",
  "transcript-state",
  "skills-usage",
  "memory-usage",
  "facts-queue",
  "facts-runs",
  "notice",
] as const

export type LockDomain = (typeof LOCK_DOMAINS)[number]

export function memoryWriterLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "memory-write.lock")
}

export function reflectionSchedulerLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "reflection-scheduler.lock")
}

export function runFinalizationLockPath(locksDirectory: string, runId: string): string {
  const trimmed = runId.trim()
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error("run id must contain a safe identifier")
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(trimmed)) {
    return path.join(locksDirectory, `finalize-${trimmed}.lock`)
  }
  const slug = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 48) || "run"
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 16)
  return path.join(locksDirectory, `finalize-${slug}-${digest}.lock`)
}

export function transcriptStateLockPath(locksDirectory: string, transcriptId: string): string {
  if (transcriptId.length === 0) throw new Error("transcript id must not be empty")
  const digest = createHash("sha256").update(transcriptId).digest("hex").slice(0, 16)
  return path.join(locksDirectory, `transcript-state-${digest}.lock`)
}

export function skillsUsageLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "skills-usage.lock")
}

export function memoryUsageLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "memory-usage.lock")
}

export function factsQueueLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "facts-queue.lock")
}

/**
 * Serialises the facts run-directory namespace: reservation scans/creates a run dir under it and
 * retention pruning renames one away under it, so a pruned name can never be freed while a
 * reservation is probing it.
 */
export function factsRunsLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "facts-runs.lock")
}

export function noticeLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "notice.lock")
}
