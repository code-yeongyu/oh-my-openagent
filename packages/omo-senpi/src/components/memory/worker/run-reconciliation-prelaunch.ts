import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { mkdir, readdir, stat } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  discardReflectionWorktree,
  GitMemoryRepo,
  RESERVATION_EVIDENCE_FILENAME,
  writeQuarantine,
  type QuarantineReason,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"

import { emitMemoryReceipt, runReceipt, type RunReceiptLedger } from "../receipts-port"
import { parseRunPrelaunchArtifact, readRunJson, writeRunJsonAtomic } from "./run-artifacts"
import { classifyGhostActive } from "./run-ghost-active"
import { classifyRunProcess, isLauncherDead } from "./run-liveness"
import type { ReconcileContext, ReflectionRunReconcileResult } from "./run-reconciliation"
import { parseReservationRunLedger, type ReservationRunLedger } from "./reservation-run-ledger"

const LAUNCH_WINDOW_MS = 60_000

export interface PrelaunchReconcile {
  readonly result?: ReflectionRunReconcileResult
  readonly retiredRunId?: string
}

export async function reconcilePrelaunch(context: ReconcileContext): Promise<PrelaunchReconcile> {
  const active = (await context.reservation.readState(
    context.deferOnSchedulerContention ? { waitTimeoutMs: 0 } : undefined,
  )).active
  if (active === undefined) return {}
  const ghost = await classifyGhostActive({ identity: context.identity, active })
  if (ghost.ghost && ghost.reason === "missing-identity") {
    if (active.launcherPid !== undefined && active.launcherHostname !== undefined) {
      if (active.launcherHostname !== context.hostname()) return {}
      if (!(await isLauncherDead(active.launcherPid, active.launcherProcessStart, context))) return {}
    }
    return { result: await releaseReservationAsFailed(context, active.runId), retiredRunId: active.runId }
  }
  if (active.reservedAt === undefined || active.launcherPid === undefined || active.launcherHostname === undefined) return {}
  const runDir = join(context.identity.paths.reflection, "runs", active.runId)
  let retiredGeneration = false
  if (existsSync(join(runDir, "ledger.json"))) {
    const ledger = await readLedger(runDir)
    const hasFinal = existsSync(join(runDir, "final.json"))
    const terminalPath = join(runDir, hasFinal ? "final.json" : "abandoned.json")
    if (ledger === undefined) {
      // A run that already finished keeps its terminal artifact as the record; only a run with no
      // terminal state is stuck because of the unreadable ledger.
      if (existsSync(terminalPath)) return releaseFinishedUnderDeadLauncher(context, active)
      if (!(await recordedProcessesDead(context, runDir))) return {}
      return quarantineUnderDeadLauncher(context, active, runDir, "ledger_unreadable")
    }
    if (!existsSync(terminalPath)) {
      if (!ghost.ghost) return {}
      retiredGeneration = true
    } else {
      const terminalAt = await terminalTimestamp(terminalPath, hasFinal) ?? Number.NaN
      const reservedAt = Date.parse(active.reservedAt)
      const startedAt = Date.parse(ledger.startedAt)
      const finalizedAt = ledger.finalizedAt === undefined ? undefined : Date.parse(ledger.finalizedAt)
      if (![terminalAt, reservedAt, startedAt].every(Number.isFinite)
        || (finalizedAt !== undefined && !Number.isFinite(finalizedAt))) {
        return releaseFinishedUnderDeadLauncher(context, active)
      }
      retiredGeneration = startedAt < reservedAt && terminalAt < reservedAt
        && (finalizedAt === undefined || finalizedAt < reservedAt)
      if (!retiredGeneration) return {}
    }
  }
  const prelaunchPath = join(runDir, "prelaunch.json")
  if (!retiredGeneration && existsSync(runDir) && !existsSync(prelaunchPath)) {
    const createdAt = (await stat(runDir)).mtimeMs
    if (context.now() - createdAt <= LAUNCH_WINDOW_MS) return {}
    return quarantineUnderDeadLauncher(context, active, runDir, "prelaunch_missing_after_deadline")
  }
  if (context.now() - Date.parse(active.reservedAt) <= LAUNCH_WINDOW_MS || active.launcherHostname !== context.hostname()) {
    return retiredGeneration ? { retiredRunId: active.runId } : {}
  }
  if (!(await isLauncherDead(active.launcherPid, active.launcherProcessStart, context))) {
    return retiredGeneration ? { retiredRunId: active.runId } : {}
  }
  // Retired artifacts are historical evidence, not resources owned by this reservation.
  if (retiredGeneration) return { result: await releaseReservationAsFailed(context, active.runId), retiredRunId: active.runId }
  if (existsSync(prelaunchPath)) {
    const prelaunch = parseRunPrelaunchArtifact(await readRunJson<unknown>(prelaunchPath))
    if (prelaunch.runId !== active.runId) throw new Error("Reflection prelaunch run id does not match reservation")
    const repo = new GitMemoryRepo({ dir: context.identity.paths.repo, agentId: context.identity.id })
    const cleanup = await discardReflectionWorktree(repo, prelaunch.worktreeDir, prelaunch.worktreeBranch)
    if (!cleanup.worktreeRemoved || !cleanup.branchRemoved) return {}
  }
  await recordInterruptedLaunch(context, runDir, active)
  return { result: await releaseReservationAsFailed(context, active.runId) }
}

/**
 * The launcher died before the run had a ledger. The run dir keeps whatever it already holds, and a
 * pre-ledger `abandoned.json` carrying every identity field a receipt needs (copied from the still-held
 * reservation, since run ids are opaque) is made durable before the reservation is released.
 */
async function recordInterruptedLaunch(context: ReconcileContext, runDir: string, active: ReservedRun): Promise<void> {
  const generation = active.reservedAt
  if (generation === undefined) throw new Error(`No durable generation for interrupted launch ${active.runId}`)
  const kind = active.request.trigger === "dream" ? "dream" : "reflection"
  const origin = active.request.origin
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeRunJsonAtomic(join(runDir, "abandoned.json"), {
    version: 1,
    runId: active.runId,
    abandonedAt: new Date(context.now()).toISOString(),
    reason: "launch_interrupted",
    generation,
    kind,
    trigger: active.request.trigger,
    ...(origin === undefined ? {} : { origin }),
    launcher: { pid: active.launcherPid, hostname: active.launcherHostname, processStart: active.launcherProcessStart ?? null },
  })
  const run: RunReceiptLedger = { kind, runId: active.runId, trigger: active.request.trigger, ...(origin === undefined ? {} : { origin }), startedAt: generation }
  await emitMemoryReceipt(context.identity.paths.runtime, runReceipt(run, "abandoned", { reason: "launch_interrupted" }), context.receipts, context.warn)
}

/**
 * A finished run whose timestamps cannot attribute it to this reservation still has its terminal
 * artifact as its one recorded outcome. Under a dead launcher the reservation is released without
 * touching the run dir, so a later backfill sees exactly one terminal state.
 */
async function releaseFinishedUnderDeadLauncher(context: ReconcileContext, active: ReservedRun): Promise<PrelaunchReconcile> {
  if (active.launcherPid === undefined || active.launcherHostname !== context.hostname()) return {}
  if (!(await isLauncherDead(active.launcherPid, active.launcherProcessStart, context))) return {}
  return { result: await releaseReservationAsFailed(context, active.runId), retiredRunId: active.runId }
}

/**
 * The launcher exits while its detached supervisor keeps running, so an unreadable ledger (for
 * example one a newer writer produced) proves nothing about the run. Its recorded supervisor and
 * child are read leniently and must both be dead or absent before the run may be quarantined.
 */
async function recordedProcessesDead(context: ReconcileContext, runDir: string): Promise<boolean> {
  let raw: Record<string, unknown>
  try {
    const value = await readRunJson<unknown>(join(runDir, "ledger.json"))
    raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
  } catch {
    raw = {}
  }
  const pid = (key: string) => typeof raw[key] === "number" ? raw[key] as number : undefined
  const start = (key: string) => typeof raw[key] === "string" || raw[key] === null ? raw[key] as string | null : undefined
  for (const [pidKey, startKey] of [["pid", "processStart"], ["childPid", "childProcessStart"]] as const) {
    const verdict = await classifyRunProcess(pid(pidKey), start(startKey), context)
    if (verdict !== "dead" && verdict !== "absent") return false
  }
  return true
}

/** Only a launcher proven dead on this host lets a run be quarantined; anything less keeps deferring. */
async function quarantineUnderDeadLauncher(
  context: ReconcileContext,
  active: ReservedRun,
  runDir: string,
  reason: QuarantineReason,
  ledger?: ReservationRunLedger,
): Promise<PrelaunchReconcile> {
  if (active.launcherPid === undefined || active.launcherHostname !== context.hostname()) return {}
  if (!(await isLauncherDead(active.launcherPid, active.launcherProcessStart, context))) return {}
  return { result: await quarantineRun(context, runDir, active.runId, reason, ledger, active), retiredRunId: active.runId }
}

/** Generation is `ledger.startedAt`, else `reservedAt`: the sentinel alone must yield the receipt's identity. */
export async function quarantineRun(
  context: ReconcileContext,
  runDir: string,
  runId: string,
  reason: QuarantineReason,
  ledger: ReservationRunLedger | undefined,
  active: ReservedRun | undefined,
): Promise<ReflectionRunReconcileResult> {
  const generation = ledger?.startedAt ?? active?.reservedAt
  if (generation === undefined) throw new Error(`No durable generation to quarantine ${runId}`)
  const origin = ledger?.origin ?? active?.request.origin
  const run: RunReceiptLedger = {
    kind: ledger?.kind ?? (active?.request.trigger === "dream" ? "dream" : "reflection"),
    runId,
    trigger: ledger?.trigger ?? active?.request.trigger ?? "unknown",
    ...(origin === undefined ? {} : { origin }),
    startedAt: generation,
  }
  const evidence = [...(await readdir(runDir)).sort(), ...(active === undefined ? [] : [RESERVATION_EVIDENCE_FILENAME])]
  await writeQuarantine(runDir, {
    version: 1,
    runId,
    kind: run.kind,
    trigger: run.trigger,
    ...(origin === undefined ? {} : { origin }),
    generation,
    reason,
    quarantinedAt: new Date(context.now()).toISOString(),
    evidence,
  }, active)
  await emitMemoryReceipt(context.identity.paths.runtime, runReceipt(run, "quarantined", { reason }), context.receipts, context.warn)
  return active === undefined ? { runId, outcome: "failed" } : releaseReservationAsFailed(context, runId)
}

async function releaseReservationAsFailed(context: ReconcileContext, runId: string): Promise<ReflectionRunReconcileResult> {
  const transition = await context.reservation.complete(
    runId,
    "failed",
    context.deferOnSchedulerContention ? { waitTimeoutMs: 0 } : undefined,
  )
  if (transition.launch !== undefined) context.launch?.(transition.launch)
  return { runId, outcome: "failed" }
}

async function readLedger(runDir: string): Promise<ReservationRunLedger | undefined> {
  try {
    return parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
  } catch {
    return undefined
  }
}

async function terminalTimestamp(path: string, final: boolean): Promise<number | undefined> {
  if (!existsSync(path)) return undefined
  try {
    const terminal = await readRunJson<{ finishedAt?: unknown; abandonedAt?: unknown } | null>(path)
    const timestamp = final ? terminal?.finishedAt : terminal?.abandonedAt
    const parsed = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
