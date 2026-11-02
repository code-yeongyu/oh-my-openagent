import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { readdir, readFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { QUARANTINE_FILENAME, readMemoryReceipts, type MemoryReceipt, type MemoryReceiptKind } from "@oh-my-opencode/memory-core"

import type { DoctorCheck } from "./doctor-checks"

const KINDS: readonly MemoryReceiptKind[] = ["dream", "reflection", "facts"]
/** `launched` and `recovered` mark progress inside a run; the last receipt per kind is its outcome. */
const NON_TERMINAL = new Set(["launched", "recovered"])
const TEXT_LIMIT = 120

export interface ReceiptSummary {
  readonly event: string
  readonly at: string
  readonly trigger: string
  readonly runId?: string
  readonly batchId?: string
  readonly reason?: string
  readonly sha?: string
  readonly detail?: string
}

export type ReceiptSummaries = Record<MemoryReceiptKind, ReceiptSummary | null>

export interface QuarantinedRun {
  readonly runId: string
  readonly reason: string
  readonly at: string | null
  readonly dir: string
  readonly evidence: readonly string[]
}

export async function checkReceipts(runtimeDir: string, now: number): Promise<{ readonly check: DoctorCheck; readonly receipts: ReceiptSummaries }> {
  const { receipts, skippedPartialLines } = await readMemoryReceipts(runtimeDir, {})
  const summaries = Object.fromEntries(KINDS.map((kind) => {
    const newest = receipts.find((receipt) => receipt.kind === kind && !NON_TERMINAL.has(receipt.event))
    return [kind, newest === undefined ? null : summarize(newest)]
  })) as ReceiptSummaries
  const parts = KINDS.map((kind) => describe(kind, summaries[kind], now))
  const skipped = skippedPartialLines === 0
    ? ""
    : ` (${skippedPartialLines} partial line${skippedPartialLines === 1 ? "" : "s"} skipped)`
  return {
    check: { name: "receipts", level: skippedPartialLines === 0 ? "ok" : "warn", detail: `${parts.join("; ")}${skipped}` },
    receipts: summaries,
  }
}

export async function checkQuarantinedRuns(reflectionDir: string): Promise<{ readonly check: DoctorCheck; readonly runs: readonly QuarantinedRun[] }> {
  const runsDir = join(reflectionDir, "runs")
  let names: string[]
  try {
    names = (await readdir(runsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    names = []
  }
  const runs: QuarantinedRun[] = []
  for (const name of names) {
    const dir = join(runsDir, name)
    if (!existsSync(join(dir, QUARANTINE_FILENAME))) continue
    runs.push(await readQuarantine(dir, name))
  }
  if (runs.length === 0) return { check: { name: "quarantined-runs", level: "ok", detail: "no quarantined runs" }, runs }
  const listed = runs.map((run) => `${run.dir} (${run.reason})`).join("; ")
  const noun = runs.length === 1 ? "1 run needs" : `${runs.length} runs need`
  return { check: { name: "quarantined-runs", level: "warn", detail: `${noun} manual disposal: ${listed}` }, runs }
}

async function readQuarantine(dir: string, name: string): Promise<QuarantinedRun> {
  try {
    const record = JSON.parse(await readFile(join(dir, QUARANTINE_FILENAME), "utf8")) as Record<string, unknown>
    return {
      runId: typeof record.runId === "string" ? record.runId : name,
      reason: typeof record.reason === "string" ? bound(record.reason) : "unknown",
      at: typeof record.quarantinedAt === "string" ? record.quarantinedAt : null,
      dir,
      evidence: Array.isArray(record.evidence) ? record.evidence.filter((item): item is string => typeof item === "string") : [],
    }
  } catch {
    return { runId: name, reason: "unreadable_sentinel", at: null, dir, evidence: [] }
  }
}

function summarize(receipt: MemoryReceipt): ReceiptSummary {
  return {
    event: receipt.event,
    at: receipt.at,
    ...(receipt.kind === "facts" ? { batchId: receipt.batchId } : { runId: receipt.runId }),
    trigger: receipt.trigger,
    ...(receipt.reason === undefined ? {} : { reason: bound(receipt.reason) }),
    ...(receipt.sha === undefined ? {} : { sha: receipt.sha }),
    ...(receipt.detail === undefined ? {} : { detail: bound(receipt.detail) }),
  }
}

function describe(kind: MemoryReceiptKind, summary: ReceiptSummary | null, now: number): string {
  if (summary === null) return `${kind} never`
  const label = summary.reason
    ?? (summary.runId === undefined ? `batch ${summary.batchId?.slice(0, 8)}` : `run ${summary.runId.slice(0, 8)}`)
  return `${kind} ${summary.event} ${age(summary.at, now)} (${label})`
}

function age(at: string, now: number): string {
  const elapsed = now - Date.parse(at)
  if (!Number.isFinite(elapsed)) return "at an unknown time"
  const seconds = Math.max(0, Math.floor(elapsed / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function bound(text: string): string {
  return text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT - 3)}...`
}
