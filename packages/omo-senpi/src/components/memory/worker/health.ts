import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import type { ReflectionOutcome } from "@oh-my-opencode/memory-core"

import { safeNotify, type ReflectionLiveSession } from "./completion"
import { reflectionRemediation } from "./remediation"

export const REFLECTION_HEALTH_ENTRY_TYPE = "senpi-memory.health"

export interface ReflectionHealthEntry {
  readonly schemaVersion: 1
  readonly identity: string
  readonly streak: number
  readonly fingerprint: string
  readonly lastReason: string
  readonly lastDetail?: string
  readonly sinceISO: string
  readonly recommendation: string
}

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
  options: { readonly limit?: number } = {},
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
  const recent = failuresBeforeSuccess.slice(0, 3).map(fingerprintOf)
  const dominant = dominantFingerprint(recent)
  const lastFailure = bounded.find((record) => record.outcome === "failed")
  const lastSuccess = bounded.find((record) => record.outcome === "merged" || record.outcome === "no_changes")
  const streakSinceISO = failuresBeforeSuccess.at(-1)?.finishedAt
  const newest = bounded[0]

  return {
    streak: failuresBeforeSuccess.length,
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

export async function emitReflectionHealthAlert(
  completionsDir: string,
  identity: string,
  live: ReflectionLiveSession | undefined,
  once: (key: string) => boolean,
): Promise<boolean> {
  if (!live?.ui) return false
  const health = await readReflectionHealth(completionsDir)
  if (health.streak < 3 || health.fingerprint.length === 0) return false
  if (health.recentFailureFingerprints.filter((item) => item === health.fingerprint).length < 2) return false
  if (!once(`${live.sessionId}:${health.fingerprint}`)) return false
  const failure = health.lastFailure
  const recommendation = reflectionRemediation(failure?.reason, failure?.detail)
  const entry: ReflectionHealthEntry = {
    schemaVersion: 1,
    identity,
    streak: health.streak,
    fingerprint: health.fingerprint,
    lastReason: failure?.reason ?? "failed",
    ...(failure?.detail === undefined ? {} : { lastDetail: failure.detail }),
    sinceISO: health.streakSinceISO ?? failure?.finishedAt ?? new Date(0).toISOString(),
    recommendation,
  }
  live.api.appendEntry(REFLECTION_HEALTH_ENTRY_TYPE, entry)
  safeNotify(live, `Memory reflection has failed ${health.streak} times (${health.fingerprint}). ${recommendation}`, "warning")
  return true
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
