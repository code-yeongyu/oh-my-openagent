import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import type { EntryRenderer } from "@code-yeongyu/senpi"
import type { ReflectionOutcome } from "@oh-my-opencode/memory-core"
import { linesComponent, normalizeRendererText } from "@oh-my-opencode/senpi-task"

export const REFLECTION_COMPLETION_ENTRY_TYPE = "senpi-memory.reflection-completion"

export interface ReflectionCompletionRecord {
  readonly schemaVersion: 1
  readonly runId: string
  readonly identity: string
  readonly category: string
  readonly model?: string
  readonly thinking?: string
  readonly conversationIds: readonly string[]
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly startedAt: string
  /** Palace Reflection-tab contract: ISO completion timestamp used for newest-first ordering. */
  readonly finishedAt: string
  readonly delivery: {
    readonly status: "pending" | "consumed"
    readonly sessionId?: string
    readonly consumedAt?: string
  }
}

export interface ReflectionCompletionApi {
  appendEntry<T = unknown>(customType: string, data?: T): void
  registerEntryRenderer(customType: string, renderer: EntryRenderer<ReflectionCompletionRecord>): void
}

export interface ReflectionCompletionUi {
  notify(message: string, level: "info" | "warning" | "error"): void
}

export interface ReflectionLiveSession {
  readonly sessionId: string
  readonly api: ReflectionCompletionApi
  readonly ui?: ReflectionCompletionUi
}

export const renderReflectionCompletionEntry: EntryRenderer<ReflectionCompletionRecord> = (entry) => {
  const record = entry.data
  if (!record) return undefined
  const detail = record.detail ? [`detail:${normalizeRendererText(record.detail)}`] : []
  return linesComponent([
    `memory reflection ${normalizeRendererText(record.outcome)}`,
    `run:${normalizeRendererText(record.runId)} category:${normalizeRendererText(record.category)}`,
    ...detail,
  ])
}

export function registerReflectionCompletionRenderer(api: ReflectionCompletionApi): void {
  api.registerEntryRenderer(REFLECTION_COMPLETION_ENTRY_TYPE, renderReflectionCompletionEntry)
}

export async function recordReflectionCompletion(
  completionsDir: string,
  record: ReflectionCompletionRecord,
  live?: ReflectionLiveSession,
): Promise<ReflectionCompletionRecord> {
  await writeRecord(completionsDir, record)
  if (!live || !record.conversationIds.includes(live.sessionId)) return record
  return deliverRecord(completionsDir, record, live)
}

export async function consumePendingReflectionCompletions(
  completionsDir: string,
  live: ReflectionLiveSession,
): Promise<readonly ReflectionCompletionRecord[]> {
  let names: string[]
  try {
    names = (await readdir(completionsDir)).filter((name) => name.endsWith(".json")).sort()
  } catch (error) {
    if (errorCode(error) === "ENOENT") return []
    throw error
  }

  const consumed: ReflectionCompletionRecord[] = []
  for (const name of names) {
    const record = await readRecord(join(completionsDir, name))
    if (!record || record.delivery.status !== "pending") continue
    if (!record.conversationIds.includes(live.sessionId)) continue
    consumed.push(await deliverRecord(completionsDir, record, live))
  }
  return consumed
}

async function deliverRecord(
  completionsDir: string,
  record: ReflectionCompletionRecord,
  live: ReflectionLiveSession,
): Promise<ReflectionCompletionRecord> {
  const delivered: ReflectionCompletionRecord = {
    ...record,
    delivery: {
      status: "consumed",
      sessionId: live.sessionId,
      consumedAt: new Date().toISOString(),
    },
  }
  live.api.appendEntry(REFLECTION_COMPLETION_ENTRY_TYPE, delivered)
  live.ui?.notify(completionMessage(delivered), completionLevel(delivered.outcome))
  await writeRecord(completionsDir, delivered)
  return delivered
}

function completionMessage(record: ReflectionCompletionRecord): string {
  if (record.outcome === "merged") return `Memory reflection ${record.runId} merged.`
  if (record.outcome === "no_changes") return `Memory reflection ${record.runId} completed with no changes.`
  if (record.outcome === "timed_out") return `Memory reflection ${record.runId} timed out; its transcript cursor was not advanced.`
  return `Memory reflection ${record.runId} ended with ${record.outcome}; its transcript cursor was not advanced.`
}

function completionLevel(outcome: ReflectionOutcome): "info" | "warning" {
  return outcome === "merged" || outcome === "no_changes" ? "info" : "warning"
}

async function writeRecord(completionsDir: string, record: ReflectionCompletionRecord): Promise<void> {
  await mkdir(completionsDir, { recursive: true, mode: 0o700 })
  const target = join(completionsDir, `${safeRunId(record.runId)}.json`)
  const temporary = `${target}.tmp-${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporary, target)
}

async function readRecord(path: string): Promise<ReflectionCompletionRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    return isCompletionRecord(parsed) ? parsed : null
  } catch {
    return null
  }
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

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
