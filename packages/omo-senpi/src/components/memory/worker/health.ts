import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import type { ReflectionOutcome } from "@oh-my-opencode/memory-core"

/**
 * A trailing failure streak stops counting once its newest failure is older than this window.
 * Pending completion delivery already expires after 7 days (COMPLETION_MAX_AGE_MS), so a streak
 * whose newest failure is past this bound can no longer change: identities that stopped
 * reflecting must not nag or badge forever off a frozen burst. A fresh failure resumes the count.
 */
export const REFLECTION_HEALTH_STALE_MS = 7 * 24 * 60 * 60_000

/**
 * READ-ONLY derived health. This module must never write: no transcript entries, no notifications,
 * no filesystem mutations. The alerting side effects live in `./health-alert`.
 */
export interface ReflectionHealth {
  readonly streak: number
  readonly fingerprint: string
  readonly lastFailure?: {
    readonly reason: string
    readonly detail?: string
    readonly finishedAt: string
  }
  readonly lastSuccessAt?: string
  /** Newest completion of any outcome, so status surfaces can report the last run that finished. */
  readonly lastOutcome?: {
    readonly runId: string
    readonly outcome: ReflectionOutcome
    readonly reason?: string
    readonly finishedAt: string
  }
  readonly counts: {
    readonly merged: number
    readonly no_changes: number
    readonly failed: number
    readonly timed_out: number
  }
  readonly pendingCount: number
  readonly recentFailureFingerprints: readonly string[]
  readonly streakSinceISO?: string
}

type HealthRecord = {
  readonly runId?: string
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly finishedAt: string
  readonly pending: boolean
}

export async function readReflectionHealth(
  completionsDir: string,
  options: { readonly limit?: number; readonly now?: number } = {},
): Promise<ReflectionHealth> {
  let names: string[]
  try {
    names = (await readdir(completionsDir)).filter((name) => name.endsWith(".json"))
  } catch {
    return emptyHealth()
  }

  const records: HealthRecord[] = []
  for (const name of names) {
    const record = await readHealthRecord(join(completionsDir, name))
    if (record !== undefined) records.push(record)
  }
  records.sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))
  const bounded = records.slice(0, Math.max(0, options.limit ?? 100))
  const counts = { merged: 0, no_changes: 0, failed: 0, timed_out: 0 }
  for (const record of bounded) {
    if (record.outcome in counts) counts[record.outcome as keyof typeof counts] += 1
  }

  const failuresBeforeSuccess: HealthRecord[] = []
  for (const record of bounded) {
    if (record.outcome === "merged" || record.outcome === "no_changes") break
    if (record.outcome === "failed") failuresBeforeSuccess.push(record)
  }
  const now = options.now ?? Date.now()
  const newestFailureAt = failuresBeforeSuccess[0] === undefined
    ? undefined
    : Date.parse(failuresBeforeSuccess[0].finishedAt)
  const stale = newestFailureAt !== undefined && Number.isFinite(newestFailureAt)
    && now - newestFailureAt > REFLECTION_HEALTH_STALE_MS
  const recent = (stale ? [] : failuresBeforeSuccess.slice(0, 3)).map(fingerprintOf)
  const dominant = dominantFingerprint(recent)
  const lastFailure = bounded.find((record) => record.outcome === "failed")
  const lastSuccess = bounded.find((record) => record.outcome === "merged" || record.outcome === "no_changes")
  const streakSinceISO = stale ? undefined : failuresBeforeSuccess.at(-1)?.finishedAt
  const newest = bounded[0]

  return {
    streak: stale ? 0 : failuresBeforeSuccess.length,
    fingerprint: dominant,
    ...(lastFailure === undefined
      ? {}
      : {
          lastFailure: {
            reason: lastFailure.reason ?? "failed",
            ...(lastFailure.detail === undefined ? {} : { detail: lastFailure.detail }),
            finishedAt: lastFailure.finishedAt,
          },
        }),
    ...(lastSuccess === undefined ? {} : { lastSuccessAt: lastSuccess.finishedAt }),
    ...(newest === undefined
      ? {}
      : {
          lastOutcome: {
            runId: newest.runId ?? "",
            outcome: newest.outcome,
            ...(newest.reason === undefined ? {} : { reason: newest.reason }),
            finishedAt: newest.finishedAt,
          },
        }),
    counts,
    pendingCount: bounded.filter((record) => record.pending).length,
    recentFailureFingerprints: recent,
    ...(streakSinceISO === undefined ? {} : { streakSinceISO }),
  }
}

export function reflectionFailureFingerprint(reason: string | undefined, detail: string | undefined): string {
  return `${reason ?? "failed"}:${(detail ?? "").slice(0, 60)}`
}

function fingerprintOf(record: HealthRecord): string {
  return reflectionFailureFingerprint(record.reason, record.detail)
}

function dominantFingerprint(fingerprints: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const fingerprint of fingerprints) counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1)
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? ""
}

async function readHealthRecord(path: string): Promise<HealthRecord | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isRecord(parsed) || typeof parsed.finishedAt !== "string" || !isOutcome(parsed.outcome)) return undefined
    const delivery = isRecord(parsed.delivery) ? parsed.delivery : undefined
    return {
      ...(typeof parsed.runId === "string" ? { runId: parsed.runId } : {}),
      outcome: parsed.outcome,
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
      ...(typeof parsed.detail === "string" ? { detail: parsed.detail } : {}),
      finishedAt: parsed.finishedAt,
      pending: delivery?.status === "pending",
    }
  } catch {
    return undefined
  }
}

function emptyHealth(): ReflectionHealth {
  return {
    streak: 0,
    fingerprint: "",
    counts: { merged: 0, no_changes: 0, failed: 0, timed_out: 0 },
    pendingCount: 0,
    recentFailureFingerprints: [],
  }
}

function isOutcome(value: unknown): value is ReflectionOutcome {
  return value === "merged"
    || value === "no_changes"
    || value === "parent_dirty"
    || value === "merge_conflict"
    || value === "dirty_uncommitted"
    || value === "failed"
    || value === "timed_out"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
