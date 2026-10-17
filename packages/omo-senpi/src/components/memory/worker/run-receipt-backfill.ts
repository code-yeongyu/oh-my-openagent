// Turns a run directory's terminal artifacts back into its receipt when the live write was lost, or the
// run finished before receipts existed. The identity the live emitter would have used is recomputed
// from the artifacts alone, so the idempotent append writes at most one line per generation and event.

import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import type { MemoryReceiptInput, ReflectionOutcome } from "@oh-my-opencode/memory-core"

import { emitMemoryReceipt, runOutcomeReceipt, runReceipt, type MemoryReceiptsPort, type ReceiptWarn, type RunReceiptLedger } from "../receipts-port"
import { readRunJson } from "./run-artifacts"
import { parseReservationRunLedger } from "./reservation-run-ledger"

const OUTCOMES = new Set<string>(["merged", "no_changes", "parent_dirty", "merge_conflict", "dirty_uncommitted", "failed", "timed_out"])

interface TerminalSentinel {
  readonly runId?: unknown
  readonly kind?: unknown
  readonly trigger?: unknown
  readonly origin?: unknown
  readonly generation?: unknown
  readonly outcome?: unknown
  readonly reason?: unknown
  readonly integrationSha?: unknown
}

export async function backfillRunReceipt(
  runtimeDir: string,
  runDir: string,
  port?: MemoryReceiptsPort,
  warn?: ReceiptWarn,
): Promise<void> {
  const receipt = await terminalReceipt(runDir)
  if (receipt !== undefined) await emitMemoryReceipt(runtimeDir, receipt, port, warn)
}

async function terminalReceipt(runDir: string): Promise<MemoryReceiptInput | undefined> {
  const ledger = await readLedger(runDir)
  if (existsSync(join(runDir, "final.json"))) {
    const final = await readSentinel(join(runDir, "final.json"))
    if (ledger === undefined || typeof final?.outcome !== "string" || !OUTCOMES.has(final.outcome)) return undefined
    const settled = typeof final.generation === "string" ? { ...ledger, startedAt: final.generation } : ledger
    return runOutcomeReceipt(settled, final.outcome as ReflectionOutcome, {
      ...(typeof final.integrationSha === "string" ? { integrationSha: final.integrationSha } : {}),
      ...(typeof final.reason === "string" ? { reason: final.reason } : {}),
    })
  }
  for (const [file, event] of [["quarantined.json", "quarantined"], ["abandoned.json", "abandoned"]] as const) {
    if (!existsSync(join(runDir, file))) continue
    const sentinel = await readSentinel(join(runDir, file))
    const source = sentinelLedger(sentinel) ?? ledger
    if (source === undefined) return undefined
    const reason = typeof sentinel?.reason === "string" ? sentinel.reason : typeof sentinel?.outcome === "string" ? sentinel.outcome : undefined
    return runReceipt(source, event, reason === undefined ? {} : { reason })
  }
  return undefined
}

/** A sentinel written by reconciliation carries its own generation, and wins for the event it records. */
function sentinelLedger(sentinel: TerminalSentinel | undefined): RunReceiptLedger | undefined {
  if (sentinel === undefined || typeof sentinel.runId !== "string" || typeof sentinel.generation !== "string") return undefined
  if (sentinel.kind !== "reflection" && sentinel.kind !== "dream") return undefined
  if (typeof sentinel.trigger !== "string") return undefined
  return {
    kind: sentinel.kind,
    runId: sentinel.runId,
    trigger: sentinel.trigger,
    ...(typeof sentinel.origin === "string" ? { origin: sentinel.origin } : {}),
    startedAt: sentinel.generation,
  }
}

async function readLedger(runDir: string): Promise<RunReceiptLedger | undefined> {
  if (!existsSync(join(runDir, "ledger.json"))) return undefined
  try {
    return parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
  } catch {
    return undefined
  }
}

async function readSentinel(path: string): Promise<TerminalSentinel | undefined> {
  try {
    const value = await readRunJson<unknown>(path)
    return typeof value === "object" && value !== null ? value as TerminalSentinel : undefined
  } catch {
    return undefined
  }
}
