import { readdir } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  REFLECTION_COMPLETION_ENTRY_TYPE,
  REFLECTION_SUMMARY_ENTRY_TYPE,
  type ReflectionCompletionRecord,
  type ReflectionCompletionSummary,
  type ReflectionLiveSession,
} from "./completion-contracts"
import { readCompletionRecord, writeCompletionRecord } from "./completion-records"
import { failureFingerprint } from "./failure-detail"
import { readReflectionRecap } from "./reflection-recap"

const DETAILED_DRAIN_LIMIT = 5
const COMPLETION_MAX_AGE_MS = 7 * 24 * 60 * 60_000

export async function consumePendingReflectionCompletions(
  completionsDir: string,
  identity: string,
  live: ReflectionLiveSession,
  nowMs = Date.now(),
): Promise<readonly ReflectionCompletionRecord[]> {
  let names: string[]
  try {
    names = (await readdir(completionsDir)).filter((name) => name.endsWith(".json")).sort()
  } catch (error) {
    if (errorCode(error) === "ENOENT") return []
    throw error
  }

  const pending: ReflectionCompletionRecord[] = []
  for (const name of names) {
    const record = await readCompletionRecord(join(completionsDir, name))
    if (record?.identity === identity && record.delivery.status === "pending") pending.push(record)
  }
  pending.sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))

  const cutoff = nowMs - COMPLETION_MAX_AGE_MS
  const fresh = pending.filter((record) => Date.parse(record.finishedAt) >= cutoff)
  const stale = pending.filter((record) => Date.parse(record.finishedAt) < cutoff)
  const consumed: ReflectionCompletionRecord[] = []
  for (const record of fresh.slice(0, DETAILED_DRAIN_LIMIT)) {
    consumed.push(await deliverReflectionCompletion(completionsDir, record, live))
  }

  const collapsed = fresh.slice(DETAILED_DRAIN_LIMIT)
  if (collapsed.length > 0) {
    live.api.appendEntry(REFLECTION_SUMMARY_ENTRY_TYPE, summarize(collapsed))
    for (const record of collapsed) consumed.push(await markDelivered(completionsDir, record, live.sessionId))
  }
  for (const record of stale) consumed.push(await markDelivered(completionsDir, record, live.sessionId))
  return consumed
}

export async function deliverReflectionCompletion(
  completionsDir: string,
  record: ReflectionCompletionRecord,
  live: ReflectionLiveSession,
): Promise<ReflectionCompletionRecord> {
  const delivered = await markDelivered(completionsDir, record, live.sessionId)
  const recap = live.identityContext === undefined ? undefined : await readReflectionRecap(live.identityContext, delivered)
  live.api.appendEntry(REFLECTION_COMPLETION_ENTRY_TYPE, recap === undefined ? delivered : { ...delivered, recap })
  return delivered
}

async function markDelivered(
  completionsDir: string,
  record: ReflectionCompletionRecord,
  sessionId: string,
): Promise<ReflectionCompletionRecord> {
  const delivered: ReflectionCompletionRecord = {
    ...record,
    delivery: {
      status: "consumed",
      sessionId,
      consumedAt: new Date().toISOString(),
    },
  }
  await writeCompletionRecord(completionsDir, delivered)
  return delivered
}

function summarize(records: readonly ReflectionCompletionRecord[]): ReflectionCompletionSummary {
  const fingerprints = new Map<string, number>()
  for (const record of records) {
    const fingerprint = completionFingerprint(record)
    fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1)
  }
  return {
    schemaVersion: 1,
    count: records.length,
    failedCount: records.filter(isUnsuccessful).length,
    oldestISO: records.at(-1)?.finishedAt ?? "",
    newestISO: records[0]?.finishedAt ?? "",
    dominantFingerprint: [...fingerprints].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "",
  }
}

function completionFingerprint(record: ReflectionCompletionRecord): string {
  return failureFingerprint(record.reason ?? record.outcome, record.detail)
}

function isUnsuccessful(record: ReflectionCompletionRecord): boolean {
  return record.outcome !== "merged" && record.outcome !== "no_changes"
}

export function safeNotify(
  live: ReflectionLiveSession,
  message: string,
  level: "info" | "warning" | "error",
): void {
  if (!live.ui) return
  try {
    live.ui.notify(message, level)
  } catch (error) {
    live.logger?.warn("memory reflection notification failed", { error: describe(error) })
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
