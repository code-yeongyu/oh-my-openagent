import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import type { MemoryIdentity } from "../identity"
import type { TranscriptJournal } from "../journal"
import { createLockRecord, getProcessStartIdentity, reflectionSchedulerLockPath, withLock } from "../locks"
import {
  completeTransition,
  evaluateTransitions,
  reserveTransition,
  type CapturedConversation,
  type JournalSnapshot,
  type ReflectionEvent,
  type ReflectionOutcome,
  type ReflectionRequest,
  type ReservationState,
  type ReservedRun,
  type TriggerConfig,
} from "./machine"

export interface ReflectionLauncherIdentity {
  readonly pid: number
  readonly hostname: string
  readonly processStart: string | null
}

export interface ReflectionReservationStoreOptions {
  readonly identity: MemoryIdentity
  readonly config: TriggerConfig
  readonly getJournal: (conversationId: string) => Promise<TranscriptJournal>
  readonly createRunId?: () => string
  readonly now?: () => Date
  readonly launcherIdentity?: () => Promise<ReflectionLauncherIdentity>
}

export interface ReservationResult {
  readonly status: "active" | "pending"
  readonly run: ReservedRun
}

export interface CompletionResult {
  readonly outcome: ReflectionOutcome
  readonly launch?: ReservedRun
}

export class ReflectionReservationStore {
  private readonly activePath: string
  private readonly pendingPath: string
  private readonly schedulerLockPath: string
  private readonly createRunId: () => string
  private readonly now: () => Date
  private readonly launcherIdentity: () => Promise<ReflectionLauncherIdentity>

  constructor(private readonly options: ReflectionReservationStoreOptions) {
    this.activePath = join(options.identity.paths.reflection, "active.lock")
    this.pendingPath = join(options.identity.paths.reflection, "pending.json")
    this.schedulerLockPath = reflectionSchedulerLockPath(options.identity.paths.locks)
    this.createRunId = options.createRunId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.launcherIdentity = options.launcherIdentity ?? currentLauncherIdentity
  }

  async evaluate(conversationId: string, event: ReflectionEvent): Promise<ReservationResult | null> {
    const journal = await this.options.getJournal(conversationId)
    if (event.kind === "compaction_accepted") {
      await journal.setPendingCompaction(true)
      return null
    }

    const evaluated = evaluateTransitions(
      {
        journal: { conversationId, state: await journal.getState(), snapshot: null },
        reservation: await this.readState(),
        config: this.options.config,
      },
      event,
    )
    if (evaluated.action.kind === "none") return null

    const snapshots: CapturedConversation[] = []
    for (const id of evaluated.action.request.conversationIds) {
      const captured = await (await this.options.getJournal(id)).captureReflectionSnapshot()
      if (captured) snapshots.push({ conversationId: id, snapshot: captured })
    }
    return this.tryReserve({ ...evaluated.action.request, snapshots })
  }

  async tryReserve(request: ReflectionRequest, signal?: AbortSignal): Promise<ReservationResult> {
    const runId = this.createRunId()
    return this.locked(runId, async () => {
      signal?.throwIfAborted()
      const current = await this.readStateUnlocked()
      signal?.throwIfAborted()
      const transition = reserveTransition(current, request, runId)
      const state = transition.result === "active"
        ? { ...transition.state, active: await this.withLaunchOwner(transition.state.active) }
        : transition.state
      signal?.throwIfAborted()
      await this.writeStateUnlocked(state)
      const run = transition.result === "active" ? state.active : state.pending
      if (!run) throw new Error("Reservation transition did not produce a run")
      return { status: transition.result, run }
    }, signal)
  }

  async complete(runId: string, outcome: ReflectionOutcome): Promise<CompletionResult> {
    return this.locked(runId, async () => {
      const current = await this.readStateUnlocked()
      const conversationIds = new Set([
        ...(current.active?.request.conversationIds ?? []),
        ...(current.pending?.request.conversationIds ?? []),
      ])
      const journals = new Map<string, TranscriptJournal>()
      const snapshots = new Map<string, JournalSnapshot>()
      for (const conversationId of conversationIds) {
        const journal = await this.options.getJournal(conversationId)
        journals.set(conversationId, journal)
        snapshots.set(conversationId, {
          conversationId,
          state: await journal.getState(),
          snapshot: null,
        })
      }

      const transition = completeTransition(
        current,
        runId,
        outcome,
        snapshots,
        this.options.config,
      )
      for (const captured of transition.finalize) {
        const journal = journals.get(captured.conversationId)
        if (journal) await journal.finalizeReflection(captured.snapshot, true)
      }
      for (const conversationId of transition.clearPendingCompaction) {
        const journal = journals.get(conversationId)
        if (journal) await journal.setPendingCompaction(false)
      }
      if ((outcome === "merged" || outcome === "no_changes") && current.active?.request.trigger === "dream") {
        await writeJsonAtomic(join(this.options.identity.paths.runtime, "dream", "state.json"), {
          last_dream_at: this.now().toISOString(),
          lastRunId: runId,
        })
      }
      const promoted = transition.launch === undefined ? undefined : await this.withLaunchOwner(transition.launch)
      const nextState = promoted === undefined ? transition.state : { ...transition.state, active: promoted }
      await this.writeStateUnlocked(nextState)
      return {
        outcome,
        ...(promoted === undefined ? {} : { launch: promoted }),
      }
    })
  }

  async readState(): Promise<ReservationState> {
    return this.locked(undefined, () => this.readStateUnlocked())
  }

  private async withLaunchOwner(run: ReservedRun | undefined): Promise<ReservedRun | undefined> {
    if (run === undefined) return undefined
    const launcher = await this.launcherIdentity()
    return {
      ...run,
      reservedAt: this.now().toISOString(),
      launcherPid: launcher.pid,
      launcherHostname: launcher.hostname,
      launcherProcessStart: launcher.processStart,
    }
  }

  private async locked<T>(runId: string | undefined, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const record = await createLockRecord("reflection-scheduler", runId ? { runId } : {})
    signal?.throwIfAborted()
    return withLock(this.schedulerLockPath, record, task, { waitTimeoutMs: 5_000, signal })
  }

  private async readStateUnlocked(): Promise<ReservationState> {
    const active = await readRun(this.activePath)
    const pending = await readRun(this.pendingPath)
    return {
      ...(active === null ? {} : { active }),
      ...(pending === null || pending.runId === active?.runId ? {} : { pending }),
    }
  }

  private async writeStateUnlocked(state: ReservationState): Promise<void> {
    await mkdir(this.options.identity.paths.reflection, { recursive: true, mode: 0o700 })
    await writeOptionalRun(this.activePath, state.active)
    await writeOptionalRun(this.pendingPath, state.pending)
  }
}

async function readRun(path: string): Promise<ReservedRun | null> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  if (!isReservedRun(parsed)) throw new Error(`Invalid reflection reservation: ${path}`)
  return parsed
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporaryPath, path)
}

async function writeOptionalRun(path: string, run: ReservedRun | undefined): Promise<void> {
  if (!run) {
    await unlink(path).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error
    })
    return
  }
  await writeJsonAtomic(path, run)
}

function isReservedRun(value: unknown): value is ReservedRun {
  if (!value || typeof value !== "object") return false
  const run = value as Record<string, unknown>
  return typeof run.runId === "string" && run.runId.length > 0 && isReflectionRequest(run.request)
}

function isReflectionRequest(value: unknown): value is ReflectionRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Record<string, unknown>
  return (
    (request.trigger === "manual" || request.trigger === "compaction" || request.trigger === "step-count" || request.trigger === "dream") &&
    (request.trigger === "dream"
      ? request.origin === "manual" || request.origin === "idle" || request.origin === "shutdown" || request.origin === "pressure"
      : request.origin === undefined) &&
    Array.isArray(request.conversationIds) && request.conversationIds.every((id) => typeof id === "string") &&
    Array.isArray(request.snapshots) &&
    (request.targetDoc === undefined || (request.trigger === "dream" && typeof request.targetDoc === "string"))
  )
}

async function currentLauncherIdentity(): Promise<ReflectionLauncherIdentity> {
  return {
    pid: process.pid,
    hostname: hostname(),
    processStart: await getProcessStartIdentity(process.pid),
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
