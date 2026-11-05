// One stale reflection-lock reaper for session start, each turn and `omo doctor --fix` (#11976, #11920).
// It owns one decision table over `runtime/reflection/` (DESIGN 4.1) and an injectable settle: a
// session settles through its reconciliation (worktree-tip recovery included), the CLI through the
// minimal writers here. Anything not proven gone is kept and reported. `omo doctor` runs a generated
// bundle of this file, so every rule carries a `rule:` tag with a scenario the parity test replays.

import { hostname as readHostname } from "node:os"
import { basename, join } from "node:path"

import { mkdir, readdir, readFile, stat, unlink } from "../fs/resilient"
import { removeTree } from "../fs/remove-tree"
import { LockContentionError, withLock } from "../locks/acquire"
import { sweepDeadOwnerLocks } from "../locks/dead-owner-sweep"
import { reflectionSchedulerLockPath, runFinalizationLockPath } from "../locks/domains"
import { createLockRecord } from "../locks/lock-record"
import { appendMemoryReceiptOnce, type MemoryReceiptInput } from "../receipts/receipts"
import { writeAbandoned, type AbandonedReason } from "./abandoned"
import type { ReservedRun } from "./machine"
import { REFLECTION_ORPHAN_GRACE_MS } from "./orphan-sweep"
import { RESERVATION_EVIDENCE_FILENAME, writeQuarantine } from "./quarantine"
import { isReservedRun, moveTornReservationAside } from "./reservation-files"
import { recordRunIdHighWater, scanRunIdHighWater } from "./run-id-high-water"
import { parseReservationRunLedger } from "./run-ledger"
import { classifyRecordedProcess } from "./run-process"
import { classifyReflectionLockHolder, reflectionLauncherLiveness, type ReflectionLockProbe, type ReflectionLockVerdict } from "./stale-holder"

export const REFLECTION_LAUNCH_WINDOW_MS = 60_000
export const STRANDED_RUN_GRACE_MS = REFLECTION_LAUNCH_WINDOW_MS + REFLECTION_ORPHAN_GRACE_MS

export type StaleLockReapAction = "launch-interrupted" | "processes-dead" | "ledger-unreadable" | "lock-torn" | "terminal-recorded"

export type StaleLockDecision =
  | { readonly kind: "none" }
  | { readonly kind: "finalize"; readonly runId: string }
  | { readonly kind: "stuck"; readonly runId: string; readonly reason: string }
  | { readonly kind: "reap"; readonly action: StaleLockReapAction; readonly runId: string; readonly reason: string }

export type StrandedRunDecision =
  | { readonly kind: "keep"; readonly reason: string }
  | { readonly kind: "reap"; readonly action: "launch-interrupted" | "processes-dead" | "ledger-unreadable"; readonly reason: string }

export interface StaleLockProbe extends ReflectionLockProbe {
  readonly now?: () => number
  /** Names of the subdirectories of `path`; empty when it does not exist. */
  readonly listDirectory?: (path: string) => Promise<readonly string[]>
  readonly modifiedAt?: (path: string) => Promise<number | undefined>
}

const TERMINAL_SENTINELS = ["final.json", "abandoned.json", "quarantined.json"] as const
const TOMBSTONE_PREFIX = ".prune-"
const TORN_RUN_ID = /reflection-run-(\d+)"/g

type TextRead = { readonly kind: "missing" } | { readonly kind: "unreadable" } | { readonly kind: "text"; readonly text: string }

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function readText(path: string, probe: StaleLockProbe): Promise<TextRead> {
  try {
    return { kind: "text", text: await (probe.readText ?? ((target: string) => readFile(target, "utf8")))(path) }
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" }
  }
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function listDirectory(path: string, probe: StaleLockProbe): Promise<readonly string[]> {
  if (probe.listDirectory !== undefined) return probe.listDirectory(path)
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

async function modifiedAt(path: string, probe: StaleLockProbe): Promise<number | undefined> {
  if (probe.modifiedAt !== undefined) return probe.modifiedAt(path)
  return stat(path).then((status) => status.mtimeMs, () => undefined)
}

async function exists(path: string, probe: StaleLockProbe): Promise<boolean> {
  return (await readText(path, probe)).kind !== "missing"
}

async function hasTerminalSentinel(runDir: string, probe: StaleLockProbe): Promise<boolean> {
  for (const name of TERMINAL_SENTINELS) if (await exists(join(runDir, name), probe)) return true
  return false
}

type RecordedProcesses = { readonly live: false } | { readonly live: true; readonly reason: string }

// The supervisor and child a ledger recorded, read leniently: an unparseable ledger records none.
async function recordedProcesses(ledger: Record<string, unknown>, probe: StaleLockProbe): Promise<RecordedProcesses> {
  for (const [role, pidKey, startKey] of [["supervisor", "pid", "processStart"], ["child", "childPid", "childProcessStart"]] as const) {
    const pid = typeof ledger[pidKey] === "number" ? ledger[pidKey] as number : undefined
    const start = typeof ledger[startKey] === "string" || ledger[startKey] === null ? ledger[startKey] as string | null : undefined
    const verdict = await classifyRecordedProcess(pid, start, probe)
    if (verdict === "alive") return { live: true, reason: `its ${role} pid ${pid} is still running` }
    if (verdict === "unknown") return { live: true, reason: `its ${role} pid ${pid} could not be checked` }
  }
  return { live: false }
}

function validLedger(value: unknown, runId: string): boolean {
  try {
    return parseReservationRunLedger(value).runId === runId
  } catch {
    return false
  }
}

async function readLedger(runDir: string, probe: StaleLockProbe): Promise<{ readonly present: false } | { readonly present: true; readonly fields: Record<string, unknown>; readonly valid: boolean }> {
  const read = await readText(join(runDir, "ledger.json"), probe)
  if (read.kind === "missing") return { present: false }
  const parsed = read.kind === "text" ? parseJson(read.text) : { ok: false as const }
  return parsed.ok
    ? { present: true, fields: fieldsOf(parsed.value), valid: validLedger(parsed.value, basename(runDir)) }
    : { present: true, fields: {}, valid: false }
}

async function liveRunBesideTornLock(reflectionDir: string, probe: StaleLockProbe): Promise<string | undefined> {
  const runsDir = join(reflectionDir, "runs")
  for (const name of await listDirectory(runsDir, probe)) {
    if (name.startsWith(".")) continue
    const runDir = join(runsDir, name)
    if (await hasTerminalSentinel(runDir, probe)) continue
    const ledger = await readLedger(runDir, probe)
    if (ledger.present && (await recordedProcesses(ledger.fields, probe)).live) return name
  }
  return undefined
}

async function tornLock(reflectionDir: string, reason: string, probe: StaleLockProbe): Promise<StaleLockDecision> {
  const live = await liveRunBesideTornLock(reflectionDir, probe)
  if (live !== undefined) return { kind: "stuck", runId: "unknown", reason: `${reason} and run ${live} may still be live` } // rule:torn-live-run
  return { kind: "reap", action: "lock-torn", runId: "unknown", reason } // rule:lock-torn
}

async function decideStuck(reflectionDir: string, verdict: Extract<ReflectionLockVerdict, { state: "stuck" }>, probe: StaleLockProbe): Promise<StaleLockDecision> {
  const passThrough: StaleLockDecision = { kind: "stuck", runId: verdict.runId, reason: verdict.reason }
  const lock = await readText(join(reflectionDir, "active.lock"), probe)
  if (lock.kind !== "text") return passThrough
  const parsed = parseJson(lock.text)
  if (!parsed.ok) return tornLock(reflectionDir, "active.lock is not valid JSON", probe)
  const fields = fieldsOf(parsed.value)
  const launcherPid = typeof fields.launcherPid === "number" ? fields.launcherPid : undefined
  const launcherHostname = typeof fields.launcherHostname === "string" ? fields.launcherHostname : undefined
  if (launcherPid === undefined || launcherHostname === undefined) {
    if (!isReservedRun(parsed.value)) return tornLock(reflectionDir, "active.lock is not a reservation", probe)
    return { kind: "stuck", runId: verdict.runId, reason: "its launcher identity is missing; a session reconciles it" } // rule:legacy-lock
  }
  if (launcherHostname !== (probe.hostname ?? readHostname)()) return passThrough
  if (await reflectionLauncherLiveness(launcherPid, fields.launcherProcessStart, probe) !== "dead") return passThrough
  const runId = verdict.runId
  const runDir = join(reflectionDir, "runs", runId)
  if (await exists(join(runDir, "outcome.json"), probe)) return passThrough
  if (!isReservedRun(parsed.value)) return tornLock(reflectionDir, "active.lock is not a reservation", probe)
  if (await hasTerminalSentinel(runDir, probe)) return { kind: "reap", action: "terminal-recorded", runId, reason: "the run already recorded its terminal state" } // rule:terminal-recorded
  const ledger = await readLedger(runDir, probe)
  if (!ledger.present) {
    const reservedAt = typeof fields.reservedAt === "string" ? Date.parse(fields.reservedAt) : Number.NaN
    if (Number.isFinite(reservedAt) && (probe.now ?? Date.now)() - reservedAt <= REFLECTION_LAUNCH_WINDOW_MS) {
      return { kind: "stuck", runId, reason: "its launcher is gone but the launch window has not closed" } // rule:launch-window
    }
    return { kind: "reap", action: "launch-interrupted", runId, reason: `launcher pid ${launcherPid} is gone and the run never started` } // rule:launch-interrupted
  }
  const processes = await recordedProcesses(ledger.fields, probe)
  if (processes.live) return { kind: "stuck", runId, reason: processes.reason } // rule:run-process-alive
  if (ledger.valid) return { kind: "reap", action: "processes-dead", runId, reason: "its launcher, supervisor and child are all gone and it recorded no outcome" } // rule:processes-dead
  return { kind: "reap", action: "ledger-unreadable", runId, reason: "its ledger cannot be read and its recorded processes are gone" } // rule:ledger-unreadable
}

export async function decideStaleReflectionLock(
  reflectionDir: string,
  probe: StaleLockProbe = {},
): Promise<{ readonly verdict: ReflectionLockVerdict; readonly decision: StaleLockDecision }> {
  const verdict = await classifyReflectionLockHolder(reflectionDir, probe)
  if (verdict.state === "none" || verdict.state === "live") return { verdict, decision: { kind: "none" } }
  if (verdict.state === "dead") return { verdict, decision: { kind: "finalize", runId: verdict.runId } } // rule:finalize
  return { verdict, decision: await decideStuck(reflectionDir, verdict, probe) }
}

export async function decideStrandedRun(runDir: string, probe: StaleLockProbe = {}): Promise<StrandedRunDecision> {
  const ledger = await readLedger(runDir, probe)
  if (!ledger.present) {
    const prelaunch = join(runDir, "prelaunch.json")
    const since = await exists(prelaunch, probe) ? await modifiedAt(prelaunch, probe) : await modifiedAt(runDir, probe)
    if (since === undefined || (probe.now ?? Date.now)() - since <= STRANDED_RUN_GRACE_MS) {
      return { kind: "keep", reason: "it is inside the launch grace window" } // rule:stranded-young
    }
    return { kind: "reap", action: "launch-interrupted", reason: "it never got a ledger" } // rule:stranded-launch-interrupted
  }
  const processes = await recordedProcesses(ledger.fields, probe)
  if (processes.live) return { kind: "keep", reason: processes.reason } // rule:stranded-process-alive
  if (ledger.valid) return { kind: "reap", action: "processes-dead", reason: "its supervisor and child are gone and it recorded no outcome" } // rule:stranded-processes-dead
  return { kind: "reap", action: "ledger-unreadable", reason: "its ledger cannot be read and its recorded processes are gone" } // rule:stranded-ledger-unreadable
}

export interface StaleLockReaperOptions {
  readonly runtimeDir: string
  readonly probe?: StaleLockProbe
  /** In-session settle (reconciliation). Absent means the minimal settle from the CLI. */
  readonly settle?: () => Promise<void>
  /** Settle even when the lock needs nothing (session start reconciles every run). */
  readonly settleAlways?: boolean
  /** False when this session already settled this run once without releasing it. */
  readonly shouldSettle?: (runId: string) => boolean
  readonly dryRun?: boolean
  readonly appendReceipt?: (runtimeDir: string, input: MemoryReceiptInput) => Promise<unknown>
}

export type StaleLockReaperAction = "none" | "settled" | "settle-declined" | "reaped" | "kept" | "would-reap"

export interface StrandedRunReport {
  readonly runId: string
  readonly decision: StrandedRunDecision
  readonly applied: boolean
}

export interface TombstoneReport {
  readonly name: string
  readonly removed: boolean
  readonly error?: string
}

export interface StaleLockReaperReport {
  readonly before: ReflectionLockVerdict
  readonly decision: StaleLockDecision
  readonly action: StaleLockReaperAction
  readonly after: ReflectionLockVerdict
  readonly stranded: readonly StrandedRunReport[]
  readonly tombstones: readonly TombstoneReport[]
  readonly warnings: readonly string[]
  readonly dryRun: boolean
}

interface ReaperContext {
  readonly runtimeDir: string
  readonly reflectionDir: string
  readonly locksDir: string
  readonly probe: StaleLockProbe
  readonly now: () => number
  readonly appendReceipt: (runtimeDir: string, input: MemoryReceiptInput) => Promise<unknown>
  readonly warnings: string[]
}

async function emitReceipt(context: ReaperContext, input: MemoryReceiptInput): Promise<void> {
  try {
    await context.appendReceipt(context.runtimeDir, input)
  } catch (error) {
    context.warnings.push(`receipt for ${"runId" in input ? input.runId : input.batchId} not written: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function underLock<T>(lockPath: string, purpose: string, task: () => Promise<T>): Promise<T | "busy"> {
  try {
    return await withLock(lockPath, await createLockRecord(purpose), task, { waitTimeoutMs: 0 })
  } catch (error) {
    if (error instanceof LockContentionError) return "busy"
    throw error
  }
}

function isoOr(value: unknown, fallback: string): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback
}

interface RunIdentity {
  readonly kind: "reflection" | "dream"
  readonly trigger: string
  readonly origin?: string
}

function identityFromLedger(fields: Record<string, unknown>, fallback: RunIdentity): RunIdentity {
  const kind = fields.kind === "dream" || fields.kind === "reflection" ? fields.kind : fallback.kind
  const trigger = typeof fields.trigger === "string" ? fields.trigger : fallback.trigger
  const origin = typeof fields.origin === "string" ? fields.origin : fallback.origin
  return { kind, trigger, ...(origin === undefined ? {} : { origin }) }
}

function identityFromReservation(active: Record<string, unknown>): RunIdentity {
  const request = fieldsOf(active.request)
  const trigger = typeof request.trigger === "string" ? request.trigger : "unknown"
  const origin = typeof request.origin === "string" ? request.origin : undefined
  return { kind: trigger === "dream" ? "dream" : "reflection", trigger, ...(origin === undefined ? {} : { origin }) }
}

async function abandonRun(context: ReaperContext, runDir: string, runId: string, reason: AbandonedReason, generation: string, identity: RunIdentity, launcher?: Record<string, unknown>): Promise<void> {
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeAbandoned(runDir, {
    version: 1,
    runId,
    abandonedAt: new Date(context.now()).toISOString(),
    reason,
    generation,
    ...identity,
    ...(launcher === undefined ? {} : {
      launcher: {
        pid: typeof launcher.launcherPid === "number" ? launcher.launcherPid : undefined,
        hostname: typeof launcher.launcherHostname === "string" ? launcher.launcherHostname : undefined,
        processStart: typeof launcher.launcherProcessStart === "string" ? launcher.launcherProcessStart : null,
      },
    }),
  })
  await emitReceipt(context, { kind: identity.kind, runId, trigger: identity.origin ?? identity.trigger, event: "abandoned", generation, reason })
}

async function quarantineRun(context: ReaperContext, runDir: string, runId: string, generation: string, identity: RunIdentity, reservation?: ReservedRun): Promise<void> {
  const evidence = [...(await readdir(runDir).catch(() => [] as string[])).sort(), ...(reservation === undefined ? [] : [RESERVATION_EVIDENCE_FILENAME])]
  await writeQuarantine(runDir, {
    version: 1,
    runId,
    kind: identity.kind,
    trigger: identity.trigger,
    ...(identity.origin === undefined ? {} : { origin: identity.origin }),
    generation,
    reason: "ledger_unreadable",
    quarantinedAt: new Date(context.now()).toISOString(),
    evidence,
  }, reservation)
  await emitReceipt(context, { kind: identity.kind, runId, trigger: identity.origin ?? identity.trigger, event: "quarantined", generation, reason: "ledger_unreadable" })
}

async function readActiveFields(reflectionDir: string): Promise<Record<string, unknown> | undefined> {
  const raw = await readFile(join(reflectionDir, "active.lock"), "utf8").catch(() => undefined)
  if (raw === undefined) return undefined
  const parsed = parseJson(raw)
  return parsed.ok ? fieldsOf(parsed.value) : undefined
}

// Releases the reservation without promoting `pending.json`: the CLI cannot launch it, and a pending
// run promoted under the CLI's pid would itself be reaped as an interrupted launch. The next evaluate
// promotes it (machine.ts reserveTransition).
async function releaseReservation(context: ReaperContext, runId: string): Promise<boolean> {
  const released = await underLock(reflectionSchedulerLockPath(context.locksDir), "reflection-scheduler", async () => {
    const active = await readActiveFields(context.reflectionDir)
    if (active?.runId !== runId) return false
    await unlink(join(context.reflectionDir, "active.lock"))
    return true
  })
  return released === true
}

async function settleActiveMinimally(context: ReaperContext, decision: Extract<StaleLockDecision, { kind: "reap" }>): Promise<boolean> {
  const runId = decision.runId
  const runDir = join(context.reflectionDir, "runs", runId)
  const written = await underLock(runFinalizationLockPath(context.locksDir, runId), "reflection-finalize", async () => {
    const again = (await decideStaleReflectionLock(context.reflectionDir, context.probe)).decision
    if (again.kind !== "reap" || again.action !== decision.action || again.runId !== runId) return false
    const active = await readActiveFields(context.reflectionDir) ?? {}
    const identity = identityFromReservation(active)
    const reservedAt = isoOr(active.reservedAt, new Date(context.now()).toISOString())
    if (decision.action === "launch-interrupted") {
      await abandonRun(context, runDir, runId, "launch_interrupted", reservedAt, identity, active)
    } else if (decision.action === "processes-dead" || decision.action === "ledger-unreadable") {
      const ledger = await readLedger(runDir, {})
      const fields = ledger.present ? ledger.fields : {}
      const generation = isoOr(fields.startedAt, reservedAt)
      if (decision.action === "processes-dead") {
        await abandonRun(context, runDir, runId, "processes_dead", generation, identityFromLedger(fields, identity))
      } else {
        await quarantineRun(context, runDir, runId, generation, identityFromLedger(fields, identity), isReservedRun(active) ? active : undefined)
      }
    }
    return true
  })
  if (written !== true) return false
  return releaseReservation(context, runId)
}

async function reapTornLock(context: ReaperContext, paths: { reflectionSessions: string; worktrees: string }): Promise<boolean> {
  const moved = await underLock(reflectionSchedulerLockPath(context.locksDir), "reflection-scheduler", async () => {
    const again = (await decideStaleReflectionLock(context.reflectionDir, context.probe)).decision
    if (again.kind !== "reap" || again.action !== "lock-torn") return false
    const bytes = await readFile(join(context.reflectionDir, "active.lock"), "utf8")
    const named = [...bytes.matchAll(TORN_RUN_ID)].map((match) => Number.parseInt(match[1] ?? "0", 10)).filter(Number.isSafeInteger)
    const scanned = await scanRunIdHighWater({ reflection: context.reflectionDir, ...paths })
    const highWater = Math.max(scanned, ...named)
    if (highWater > 0) await recordRunIdHighWater(context.reflectionDir, highWater)
    const at = new Date(context.now())
    const name = await moveTornReservationAside(context.reflectionDir, bytes, at)
    if (name === undefined) return false
    const tornRun = named.length === 0 ? "unknown" : `reflection-run-${Math.max(...named)}`
    await emitReceipt(context, { kind: "reflection", runId: tornRun, trigger: "unknown", event: "abandoned", generation: at.toISOString(), reason: "lock_torn" })
    return true
  })
  return moved === true
}

async function strandedRuns(context: ReaperContext, apply: boolean): Promise<StrandedRunReport[]> {
  const runsDir = join(context.reflectionDir, "runs")
  const reserved = new Set<string>()
  for (const name of ["active.lock", "pending.json"]) {
    const raw = await readFile(join(context.reflectionDir, name), "utf8").catch(() => undefined)
    const parsed = raw === undefined ? undefined : parseJson(raw)
    if (parsed?.ok === true && typeof fieldsOf(parsed.value).runId === "string") reserved.add(fieldsOf(parsed.value).runId as string)
  }
  const reports: StrandedRunReport[] = []
  for (const runId of await listDirectory(runsDir, {})) {
    if (runId.startsWith(".") || reserved.has(runId)) continue
    const runDir = join(runsDir, runId)
    if (await hasTerminalSentinel(runDir, {})) continue
    const decision = await decideStrandedRun(runDir, context.probe)
    if (decision.kind === "keep" || !apply) {
      reports.push({ runId, decision, applied: false })
      continue
    }
    const applied = await underLock(runFinalizationLockPath(context.locksDir, runId), "reflection-finalize", async () => {
      if (await hasTerminalSentinel(runDir, {})) return false
      const ledger = await readLedger(runDir, {})
      const fields = ledger.present ? ledger.fields : {}
      const unknown: RunIdentity = { kind: "reflection", trigger: "unknown" }
      if (decision.action === "launch-interrupted") {
        const prelaunch = join(runDir, "prelaunch.json")
        const since = await exists(prelaunch, {}) ? await modifiedAt(prelaunch, {}) : await modifiedAt(runDir, {})
        await abandonRun(context, runDir, runId, "launch_interrupted", new Date(since ?? context.now()).toISOString(), unknown)
        return true
      }
      const since = await modifiedAt(runDir, {})
      const generation = isoOr(fields.startedAt, new Date(since ?? context.now()).toISOString())
      if (decision.action === "processes-dead") await abandonRun(context, runDir, runId, "processes_dead", generation, identityFromLedger(fields, unknown))
      else await quarantineRun(context, runDir, runId, generation, identityFromLedger(fields, unknown))
      return true
    })
    reports.push({ runId, decision, applied: applied === true })
  }
  return reports
}

async function removeTombstones(context: ReaperContext, apply: boolean): Promise<TombstoneReport[]> {
  const runsDir = join(context.reflectionDir, "runs")
  const names = (await readdir(runsDir).catch(() => [] as string[])).filter((name) => name.startsWith(TOMBSTONE_PREFIX)).sort()
  const reports: TombstoneReport[] = []
  for (const name of names) {
    if (!apply) {
      reports.push({ name, removed: false })
      continue
    }
    try {
      await removeTree(join(runsDir, name))
      reports.push({ name, removed: true })
    } catch (error) {
      reports.push({ name, removed: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return reports
}

export async function runStaleLockReaper(options: StaleLockReaperOptions): Promise<StaleLockReaperReport> {
  const probe = options.probe ?? {}
  const context: ReaperContext = {
    runtimeDir: options.runtimeDir,
    reflectionDir: join(options.runtimeDir, "reflection"),
    locksDir: join(options.runtimeDir, "locks"),
    probe,
    now: probe.now ?? Date.now,
    appendReceipt: options.appendReceipt ?? appendMemoryReceiptOnce,
    warnings: [],
  }
  const paths = { reflectionSessions: join(options.runtimeDir, "reflection-sessions"), worktrees: join(options.runtimeDir, "worktrees") }
  const { verdict: before, decision } = await decideStaleReflectionLock(context.reflectionDir, probe)
  const minimal = options.settle === undefined
  let action: StaleLockReaperAction
  if (options.dryRun === true) {
    action = decision.kind === "reap" ? "would-reap" : decision.kind === "none" ? "none" : "kept"
  } else if (decision.kind === "reap" && decision.action === "lock-torn") {
    action = await reapTornLock(context, paths) ? "reaped" : "kept"
  } else if (decision.kind === "reap" || decision.kind === "finalize") {
    if (options.settle === undefined) {
      action = decision.kind === "reap" && await settleActiveMinimally(context, decision) ? "reaped" : "kept"
    } else if (options.shouldSettle?.(decision.runId) === false) {
      action = "settle-declined"
    } else {
      await options.settle()
      action = "settled"
    }
  } else {
    action = decision.kind === "none" ? "none" : "kept"
  }
  if (options.settle !== undefined && options.settleAlways === true && options.dryRun !== true && action !== "settled") await options.settle()
  const stranded = minimal ? await strandedRuns(context, options.dryRun !== true) : []
  const tombstones = minimal ? await removeTombstones(context, options.dryRun !== true) : []
  const after = options.dryRun === true ? before : await classifyReflectionLockHolder(context.reflectionDir, probe)
  return { before, decision, action, after, stranded, tombstones, warnings: context.warnings, dryRun: options.dryRun === true }
}

export interface DeadOwnerLockReport {
  readonly reclaimed: readonly string[]
  readonly kept: ReadonlyArray<{ readonly name: string; readonly reason: string }>
}

export async function reclaimDeadOwnerLocks(locksDir: string): Promise<DeadOwnerLockReport> {
  const names = (await readdir(locksDir).catch(() => [] as string[])).filter((name) => name.endsWith(".lock")).sort()
  const reclaimed: string[] = []
  const failures = new Map<string, string>()
  await sweepDeadOwnerLocks(locksDir, {
    onReclaimed: (lockPath) => { reclaimed.push(basename(lockPath)) },
    onFailure: (lockPath, error) => { failures.set(basename(lockPath), error instanceof Error ? error.message : String(error)) },
  })
  const kept = names.filter((name) => !reclaimed.includes(name)).map((name) => ({ name, reason: failures.get(name) ?? "owner is alive or not provably dead" }))
  return { reclaimed, kept }
}

export function formatStaleLockFixLines(identity: string, report: StaleLockReaperReport, locks?: DeadOwnerLockReport): string[] {
  const lines: string[] = []
  const { decision } = report
  if (decision.kind === "reap" || decision.kind === "finalize") {
    const label = decision.kind === "reap" ? decision.action : "finalize"
    if (report.action === "would-reap") lines.push(`WOULD FIX ${identity} active.lock run ${decision.runId} (${label})`)
    else if (report.action === "reaped" || (report.action === "settled" && (report.after.state === "none" || ("runId" in report.after && report.after.runId !== decision.runId)))) {
      lines.push(`FIXED ${identity} active.lock run ${decision.runId} (${label})`)
    } else if (decision.kind === "finalize" && report.action === "kept") {
      lines.push(`KEPT ${identity} active.lock run ${decision.runId} (it recorded its outcome; open a session to finalize it)`)
    } else {
      lines.push(`KEPT ${identity} active.lock run ${decision.runId} (${label} did not release the lock)`)
    }
  } else if (decision.kind === "stuck") {
    lines.push(`KEPT ${identity} active.lock run ${decision.runId} (${decision.reason})`)
  }
  for (const entry of report.stranded) {
    if (entry.decision.kind !== "reap") continue
    lines.push(`${entry.applied ? "FIXED" : report.dryRun ? "WOULD FIX" : "KEPT"} ${identity} run ${entry.runId} (${entry.decision.action})`)
  }
  for (const tombstone of report.tombstones) {
    if (tombstone.removed) lines.push(`FIXED ${identity} removed tombstone ${tombstone.name}`)
    else if (tombstone.error !== undefined) lines.push(`KEPT ${identity} tombstone ${tombstone.name} (${tombstone.error})`)
  }
  for (const warning of report.warnings) lines.push(`WARN ${identity} ${warning}`)
  if (locks !== undefined) {
    const failed = locks.kept.filter((entry) => entry.reason !== "owner is alive or not provably dead")
    lines.push(`INFO ${identity} locks reclaimed ${locks.reclaimed.length}, kept ${locks.kept.length}${failed.length === 0 ? "" : ` (${failed.map((entry) => `${entry.name}: ${entry.reason}`).join("; ")})`}`)
  }
  return lines
}
