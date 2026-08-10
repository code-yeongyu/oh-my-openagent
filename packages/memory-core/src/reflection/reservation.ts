import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { MemoryIdentity } from "../identity"
import type { TranscriptJournal } from "../journal"
import { createLockRecord, reflectionSchedulerLockPath, withLock } from "../locks"
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

export interface ReflectionReservationStoreOptions {
  readonly identity: MemoryIdentity
  readonly config: TriggerConfig
  readonly getJournal: (conversationId: string) => Promise<TranscriptJournal>
  readonly createRunId?: () => string
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

  constructor(private readonly options: ReflectionReservationStoreOptions) {
    this.activePath = join(options.identity.paths.reflection, "active.lock")
    this.pendingPath = join(options.identity.paths.reflection, "pending.json")
    this.schedulerLockPath = reflectionSchedulerLockPath(options.identity.paths.locks)
    this.createRunId = options.createRunId ?? randomUUID
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

  async tryReserve(request: ReflectionRequest): Promise<ReservationResult> {
    const runId = this.createRunId()
    return this.locked(runId, async () => {
      const current = await this.readStateUnlocked()
      const transition = reserveTransition(current, request, runId)
      await this.writeStateUnlocked(transition.state)
      const run = transition.result === "active" ? transition.state.active : transition.state.pending
      if (!run) throw new Error("Reservation transition did not produce a run")
      return { status: transition.result, run }
    })
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
      await this.writeStateUnlocked(transition.state)
      return {
        outcome,
        ...(transition.launch === undefined ? {} : { launch: transition.launch }),
      }
    })
  }

  async readState(): Promise<ReservationState> {
    return this.locked(undefined, () => this.readStateUnlocked())
  }

  private async locked<T>(runId: string | undefined, task: () => Promise<T>): Promise<T> {
    const record = await createLockRecord("reflection-scheduler", runId ? { runId } : {})
    return withLock(this.schedulerLockPath, record, task, { waitTimeoutMs: 5_000 })
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

async function writeOptionalRun(path: string, run: ReservedRun | undefined): Promise<void> {
  if (!run) {
    await unlink(path).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error
    })
    return
  }
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  await writeFile(temporaryPath, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporaryPath, path)
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
    (request.trigger === "manual" || request.trigger === "compaction" || request.trigger === "step-count") &&
    Array.isArray(request.conversationIds) && request.conversationIds.every((id) => typeof id === "string") &&
    Array.isArray(request.snapshots)
  )
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
