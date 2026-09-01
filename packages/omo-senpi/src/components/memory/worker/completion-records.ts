import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "@oh-my-opencode/memory-core/fs"
import { basename, join } from "node:path"

import type { ReflectionCompletionRecord } from "./completion-contracts"

export async function ensureReflectionCompletion(
  completionsDir: string,
  desired: ReflectionCompletionRecord,
): Promise<ReflectionCompletionRecord> {
  const target = join(completionsDir, `${safeRunId(desired.runId)}.json`)
  const existing = await readCompletionRecord(target)
  if (existing !== null) {
    if (!sameCompletion(existing, desired)) {
      throw new Error(`Reflection completion record mismatch for ${desired.runId}`)
    }
    return existing
  }
  await writeCompletionRecord(completionsDir, desired)
  return desired
}

export async function readReflectionCompletion(
  completionsDir: string,
  runId: string,
): Promise<ReflectionCompletionRecord | null> {
  return readCompletionRecord(join(completionsDir, `${safeRunId(runId)}.json`))
}

export async function writeCompletionRecord(
  completionsDir: string,
  record: ReflectionCompletionRecord,
): Promise<void> {
  await mkdir(completionsDir, { recursive: true, mode: 0o700 })
  const target = join(completionsDir, `${safeRunId(record.runId)}.json`)
  const temporary = `${target}.tmp-${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporary, target)
}

export async function readCompletionRecord(path: string): Promise<ReflectionCompletionRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    return isCompletionRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function sameCompletion(
  left: ReflectionCompletionRecord,
  right: ReflectionCompletionRecord,
): boolean {
  return JSON.stringify({ ...left, delivery: undefined })
    === JSON.stringify({ ...right, delivery: undefined })
}

function isCompletionRecord(value: unknown): value is ReflectionCompletionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const delivery = record.delivery
  return record.schemaVersion === 1
    && typeof record.runId === "string"
    && typeof record.identity === "string"
    && typeof record.category === "string"
    && Array.isArray(record.conversationIds)
    && record.conversationIds.every((id) => typeof id === "string")
    && (record.trigger === "manual" || record.trigger === "compaction" || record.trigger === "step-count" || record.trigger === "dream")
    && (record.trigger === "dream"
      ? record.origin === "manual" || record.origin === "idle" || record.origin === "shutdown" || record.origin === "pressure"
      : record.origin === undefined)
    && typeof record.outcome === "string"
    && typeof record.startedAt === "string"
    && typeof record.finishedAt === "string"
    && !!delivery && typeof delivery === "object" && !Array.isArray(delivery)
    && (((delivery as Record<string, unknown>).status === "pending") || ((delivery as Record<string, unknown>).status === "consumed"))
}

function safeRunId(runId: string): string {
  const safe = basename(runId.trim()).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!safe || safe === "." || safe === "..") throw new TypeError("runId must contain a safe identifier")
  return safe.slice(0, 80)
}
