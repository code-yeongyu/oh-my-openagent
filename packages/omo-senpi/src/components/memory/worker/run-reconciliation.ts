import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { readdir } from "@oh-my-opencode/memory-core/fs"
import { hostname as readHostname } from "node:os"
import { join } from "node:path"

import {
  LockContentionError,
  readCurrentMachineHash,
  type MemoryIdentity,
  type ProcessLiveness,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"

import {
  readRunJson,
  runOutcomeMatchesLedger,
  type RunOutcome,
} from "./run-artifacts"
import {
  abandonReservationRun,
  failReservationRun,
  finalizeRecordedOutcome,
  type ReservationRunResult,
  type ReservationStatePort,
} from "./run-finalization"
import { backfillRunReceipt } from "./run-receipt-backfill"
import { classifyRunProcess, signalRecordedProcessGroup, waitUntil as waitForTime } from "./run-liveness"
import { quarantineRun, reconcilePrelaunch } from "./run-reconciliation-prelaunch"
import { RunTerminalClaimUnrecoverableError } from "./run-terminal-claim"
import { parseReservationRunLedger, type ReservationRunLedger } from "./reservation-run-ledger"
import type { MemoryReceiptsPort, ReceiptWarn } from "../receipts-port"
import { sweepReflectionRunOrphans, type ReflectionSweepLogger } from "./run-reconciliation-sweep"
import { waitForRunSentinel, type SentinelWaitResult } from "./run-sentinel"
import { sweepStrandedRunTemporaries } from "./run-temporaries"

export type ReflectionRunReconcileResult = Pick<ReservationRunResult, "runId" | "outcome">

export interface ReflectionRunReconciliationOptions {
  readonly identity: MemoryIdentity
  readonly reservation: ReservationStatePort
  /** Cancels observation only; never turns a live run into a terminal outcome. */
  readonly signal?: AbortSignal
  readonly launch?: (run: ReservedRun) => void
  readonly now?: () => number
  readonly hostname?: () => string
  readonly machineHash?: () => Promise<string | null>
  readonly getPidLiveness?: (pid: number) => ProcessLiveness
  readonly getProcessStartIdentity?: (pid: number) => Promise<string | null>
  readonly waitForOutcome?: (path: string, deadlineAt: number, signal?: AbortSignal) => Promise<SentinelWaitResult>
  readonly waitUntil?: (deadlineAt: number, signal?: AbortSignal) => Promise<void>
  readonly signalProcessGroup?: (pid: number, signal: NodeJS.Signals) => void
  readonly withWriterLock?: <T>(operation: () => Promise<T>) => Promise<T>
  readonly logger?: ReflectionSweepLogger
  /** Bind-time maintenance defers when another session is scheduling this identity. */
  readonly deferOnSchedulerContention?: boolean
  readonly receipts?: MemoryReceiptsPort
  readonly warn?: ReceiptWarn
}

export type ReconcileContext = Required<Pick<ReflectionRunReconciliationOptions, "now" | "hostname" | "machineHash">>
  & ReflectionRunReconciliationOptions

export async function reconcileReflectionRuns(
  options: ReflectionRunReconciliationOptions,
): Promise<ReflectionRunReconcileResult[]> {
  const context: ReconcileContext = {
    ...options,
    now: options.now ?? Date.now,
    hostname: options.hostname ?? readHostname,
    machineHash: options.machineHash ?? readCurrentMachineHash,
  }
  try {
    context.signal?.throwIfAborted()
    const results: ReflectionRunReconcileResult[] = []
    const prelaunch = await reconcilePrelaunch(context)
    context.signal?.throwIfAborted()
    if (prelaunch.result !== undefined) results.push(prelaunch.result)
    await sweepStrandedRunTemporaries(
      join(options.identity.paths.reflection, "completions"), context.now(), context.getPidLiveness,
    )
    const runsDir = join(options.identity.paths.reflection, "runs")
    for (const name of await directoryNames(runsDir)) {
      context.signal?.throwIfAborted()
      // A retired-generation dir shares the active reservation's id; settling it through the
      // normal path would complete the live reservation, so it waits for a later pass.
      if (name === prelaunch.retiredRunId) continue
      const runDir = join(runsDir, name)
      await sweepStrandedRunTemporaries(runDir, context.now(), context.getPidLiveness)
      context.signal?.throwIfAborted()
      if (["final.json", "abandoned.json", "quarantined.json"].some((file) => existsSync(join(runDir, file)))) {
        await backfillRunReceipt(options.identity.paths.runtime, runDir, options.receipts, options.warn)
        continue
      }
      if (!existsSync(join(runDir, "ledger.json"))) continue
      const ledger = await readLedgerOrUndefined(runDir)
      context.signal?.throwIfAborted()
      if (ledger === undefined) continue
      const result = await reconcileRunOrQuarantine(context, runDir, ledger)
      if (result !== undefined) results.push({ runId: result.runId, outcome: result.outcome })
    }
    context.signal?.throwIfAborted()
    await sweepReflectionRunOrphans(context)
    return results
  } catch (error) {
    if (context.deferOnSchedulerContention && error instanceof LockContentionError) return []
    throw error
  }
}

async function reconcileRunOrQuarantine(
  context: ReconcileContext,
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<ReflectionRunReconcileResult | undefined> {
  try {
    return await reconcileRun(context, runDir, ledger)
  } catch (error) {
    if (!(error instanceof RunTerminalClaimUnrecoverableError)) throw error
    const active = (await context.reservation.readState(
      context.deferOnSchedulerContention ? { waitTimeoutMs: 0 } : undefined,
    )).active
    context.signal?.throwIfAborted()
    return quarantineRun(context, runDir, ledger.runId, "terminal_claim_unrecoverable", ledger, active?.runId === ledger.runId ? active : undefined)
  }
}

async function readLedgerOrUndefined(runDir: string): Promise<ReservationRunLedger | undefined> {
  try {
    return parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
  } catch {
    return undefined
  }
}

async function reconcileRun(
  context: ReconcileContext,
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<ReflectionRunReconcileResult | undefined> {
  const outcomePath = join(runDir, "outcome.json")
  const matching = await hasMatchingOutcome(outcomePath, ledger)
  context.signal?.throwIfAborted()
  if (matching) {
    return await finalizeRecordedOutcome(context, runDir, ledger, { recovered: true })
  }
  if (ledger.launching === true && context.now() <= ledger.hardDeadlineAt) return undefined
  const supervisor = await classifyRunProcess(ledger.pid, ledger.processStart, context)
  context.signal?.throwIfAborted()
  if (ledger.queued === true && (supervisor === "alive" || supervisor === "unknown")) return undefined
  if (supervisor === "alive" || supervisor === "unknown") {
    const wait = context.waitForOutcome ?? ((path, deadlineAt, signal) => waitForRunSentinel(path, deadlineAt, context.now, signal))
    await wait(outcomePath, ledger.deadlineAt, context.signal)
    // The sentinel's abort result is also "timeout". It is NOT evidence the run timed out:
    // leave its artifacts and reservation intact for the next observer before any terminal claim.
    context.signal?.throwIfAborted()
    const refreshed = parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
    const matching = await hasMatchingOutcome(outcomePath, refreshed)
    context.signal?.throwIfAborted()
    if (matching) {
      return await finalizeRecordedOutcome(context, runDir, refreshed, { recovered: true })
    }
    if (refreshed.launching === true && context.now() <= refreshed.hardDeadlineAt) return undefined
    const freshSupervisor = await classifyRunProcess(refreshed.pid, refreshed.processStart, context)
    context.signal?.throwIfAborted()
    if (refreshed.queued === true && (freshSupervisor === "alive" || freshSupervisor === "unknown")) return undefined
    if (freshSupervisor === "unknown" || freshSupervisor === "absent") {
      return await abandonReservationRun(context, runDir, refreshed)
    }
    return freshSupervisor === "alive" ? undefined : await reconcileDeadSupervisor(context, runDir, refreshed)
  }
  return await reconcileDeadSupervisor(context, runDir, ledger)
}

async function hasMatchingOutcome(
  outcomePath: string,
  ledger: ReservationRunLedger,
): Promise<boolean> {
  if (!existsSync(outcomePath)) return false
  const outcome = await readRunJson<RunOutcome>(outcomePath)
  return runOutcomeMatchesLedger(ledger, outcome)
}

// The child exited on its own after the supervisor died, so a tip it committed may be complete.
const RECOVER_TIP = { recoverWorktreeTip: true } as const
const SUPERVISOR_DIED_DETAIL = "reflection supervisor died before publishing an outcome"
const CHILD_KILLED_AFTER_DEADLINE_DETAIL = "reflection child outlived its deadline after the supervisor died and was killed"

async function reconcileDeadSupervisor(
  context: ReconcileContext,
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<ReflectionRunReconcileResult | undefined> {
  let child = await classifyRunProcess(ledger.childPid, ledger.childProcessStart, context)
  context.signal?.throwIfAborted()
  if (child === "unknown") return await abandonReservationRun(context, runDir, ledger)
  if (child === "dead" || child === "absent") {
    return await failReservationRun(context, runDir, ledger, "failed", deadRunDetail(ledger, child), RECOVER_TIP)
  }
  const wait = context.waitUntil ?? ((deadlineAt, signal) => waitForTime(deadlineAt, context.now, signal))
  await wait(ledger.hardDeadlineAt, context.signal)
  context.signal?.throwIfAborted()
  child = await classifyRunProcess(ledger.childPid, ledger.childProcessStart, context)
  context.signal?.throwIfAborted()
  if (child === "dead") return await failReservationRun(context, runDir, ledger, "failed", deadRunDetail(ledger, child), RECOVER_TIP)
  if (child === "unknown") return await abandonReservationRun(context, runDir, ledger)
  const signal = context.signalProcessGroup ?? signalRecordedProcessGroup
  if (ledger.childPid !== undefined) signal(ledger.childPid, "SIGTERM")
  await wait(ledger.deadlineAt, context.signal)
  context.signal?.throwIfAborted()
  child = await classifyRunProcess(ledger.childPid, ledger.childProcessStart, context)
  context.signal?.throwIfAborted()
  if (child === "unknown") return await abandonReservationRun(context, runDir, ledger)
  if (child === "alive" && ledger.childPid !== undefined) {
    signal(ledger.childPid, "SIGKILL")
    child = await classifyRunProcess(ledger.childPid, ledger.childProcessStart, context)
    context.signal?.throwIfAborted()
  }
  return child === "dead"
    ? await failReservationRun(context, runDir, ledger, "timed_out", `${CHILD_KILLED_AFTER_DEADLINE_DETAIL}\n${deadProcesses(ledger)}`)
    : undefined
}

function deadRunDetail(ledger: ReservationRunLedger, child: "dead" | "absent"): string {
  const childState = child === "absent" ? "no child was recorded" : "the child is dead too"
  return `${SUPERVISOR_DIED_DETAIL}; ${childState}\n${deadProcesses(ledger)}`
}

function deadProcesses(ledger: ReservationRunLedger): string {
  return `supervisor pid ${ledger.pid ?? "unknown"}, child pid ${ledger.childPid ?? "unknown"}`
}

async function directoryNames(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}
