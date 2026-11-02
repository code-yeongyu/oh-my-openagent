import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { mkdir } from "../fs/resilient"
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
import {
  gateReflectionRequest,
  isAutomaticReflectionRequest,
  markReflectionProbe,
  type ReflectionFailureSignal,
  type ReflectionParkState,
} from "./park"
import { PARK_FILENAME, ReflectionParkFile, type ReflectionParkTransition } from "./park-file"
import {
  currentLauncherIdentity,
  readRun,
  sweepReservationTemporaries,
  writeJsonAtomic,
  writeOptionalRun,
  type ReflectionLauncherIdentity,
} from "./reservation-files"

export type { ReflectionLauncherIdentity } from "./reservation-files"

export interface ReflectionReservationStoreOptions {
  readonly identity: MemoryIdentity
  readonly config: TriggerConfig
  readonly getJournal: (conversationId: string) => Promise<TranscriptJournal>
  readonly createRunId?: () => string | Promise<string>
  readonly now?: () => Date
  readonly launcherIdentity?: () => Promise<ReflectionLauncherIdentity>
}

export type ReservationResult =
  | { readonly status: "active" | "pending"; readonly run: ReservedRun }
  | { readonly status: "parked"; readonly park: ReflectionParkState; readonly nextProbeAt: string }

export interface ReflectionReservationLockOptions {
  readonly waitTimeoutMs?: number
}

export interface ReflectionCompletionOptions extends ReflectionReservationLockOptions {
  readonly failure?: ReflectionFailureSignal
}

export interface CompletionResult {
  readonly outcome: ReflectionOutcome
  readonly launch?: ReservedRun
  readonly park: ReflectionParkTransition
}

const RESERVATION_FILES = ["active.lock", "pending.json", PARK_FILENAME] as const

export class ReflectionReservationStore {
  private readonly activePath: string
  private readonly pendingPath: string
  private readonly parkFile: ReflectionParkFile
  private readonly schedulerLockPath: string
  private readonly createRunId: () => string | Promise<string>
  private readonly now: () => Date
  private readonly launcherIdentity: () => Promise<ReflectionLauncherIdentity>

  constructor(private readonly options: ReflectionReservationStoreOptions) {
    this.activePath = join(options.identity.paths.reflection, "active.lock")
    this.pendingPath = join(options.identity.paths.reflection, "pending.json")
    this.schedulerLockPath = reflectionSchedulerLockPath(options.identity.paths.locks)
    this.createRunId = options.createRunId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.parkFile = new ReflectionParkFile(options.identity.paths.reflection, this.now)
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
        now: this.now().toISOString(),
        journal: { conversationId, state: await journal.getState(), snapshot: null },
        reservation: await this.readState(),
        config: this.options.config,
      },
      event,
    )
    if (evaluated.action.kind === "none") return null

    // A parked identity is refused before any snapshot is captured; tryReserve re-checks under the lock.
    const park = await this.parkFile.read()
    const gate = gateReflectionRequest(park, evaluated.action.request, this.now().toISOString())
    if (gate.kind === "parked") return { status: "parked", park, nextProbeAt: gate.nextProbeAt }

    const snapshots: CapturedConversation[] = []
    for (const id of evaluated.action.request.conversationIds) {
      const captured = await (await this.options.getJournal(id)).captureReflectionSnapshot()
      if (captured) snapshots.push({ conversationId: id, snapshot: captured })
    }
    return this.tryReserve({ ...evaluated.action.request, snapshots })
  }

  async tryReserve(request: ReflectionRequest, signal?: AbortSignal): Promise<ReservationResult> {
    // Minting happens INSIDE the scheduler lock: a disk-scoped factory derives the next id from
    // persisted state, so two processes reserving concurrently must not observe the same state.
    return this.locked(undefined, async () => {
      signal?.throwIfAborted()
      const now = this.now().toISOString()
      const park = await this.parkFile.read()
      const gate = gateReflectionRequest(park, request, now)
      if (gate.kind === "parked") return { status: "parked", park, nextProbeAt: gate.nextProbeAt }
      const runId = await this.createRunId()
      signal?.throwIfAborted()
      const current = await this.readStateUnlocked()
      signal?.throwIfAborted()
      const transition = reserveTransition(current, request, runId)
      const state = transition.result === "active"
        ? { ...transition.state, active: await this.withLaunchOwner(transition.state.active) }
        : transition.state
      signal?.throwIfAborted()
      if (gate.kind === "probe" && transition.result === "active") await this.parkFile.write(markReflectionProbe(park, now))
      await this.writeStateUnlocked(state)
      const run = transition.result === "active" ? state.active : state.pending
      if (!run) throw new Error("Reservation transition did not produce a run")
      return { status: transition.result, run }
    }, signal)
  }

  async complete(
    runId: string,
    outcome: ReflectionOutcome,
    options?: ReflectionCompletionOptions,
  ): Promise<CompletionResult> {
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
      const succeeded = outcome === "merged" || outcome === "no_changes"
      if (!succeeded && current.active?.request.trigger !== "manual" && current.active?.request.trigger !== "dream") {
        for (const id of current.active?.request.conversationIds ?? []) await journals.get(id)?.recordReflectionFailure()
      }
      for (const captured of transition.finalize) {
        const journal = journals.get(captured.conversationId)
        if (journal) await journal.finalizeReflection(captured.snapshot, true)
      }
      for (const conversationId of transition.clearPendingCompaction) {
        const journal = journals.get(conversationId)
        if (journal) await journal.setPendingCompaction(false)
      }
      if (succeeded && current.active?.request.trigger === "dream") {
        await writeJsonAtomic(join(this.options.identity.paths.runtime, "dream", "state.json"), {
          last_dream_at: this.now().toISOString(),
          lastRunId: runId,
        })
      }
      const park = await this.parkFile.transition(current.active, runId, outcome, options?.failure)
      const launch = park.parked && transition.launch !== undefined && isAutomaticReflectionRequest(transition.launch.request)
        ? undefined
        : transition.launch
      const promoted = launch === undefined ? undefined : await this.withLaunchOwner(launch)
      const nextState = promoted === undefined ? { ...transition.state, active: undefined } : { ...transition.state, active: promoted }
      await this.writeStateUnlocked(nextState)
      return {
        outcome,
        ...(promoted === undefined ? {} : { launch: promoted }),
        park,
      }
    }, undefined, options)
  }

  async readState(lockOptions?: ReflectionReservationLockOptions): Promise<ReservationState> {
    return this.locked(undefined, () => this.readStateUnlocked(), undefined, lockOptions)
  }

  async readPark(lockOptions?: ReflectionReservationLockOptions): Promise<ReflectionParkState> {
    return this.locked(undefined, () => this.parkFile.read(), undefined, lockOptions)
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

  private async locked<T>(
    runId: string | undefined,
    task: () => Promise<T>,
    signal?: AbortSignal,
    lockOptions?: ReflectionReservationLockOptions,
  ): Promise<T> {
    signal?.throwIfAborted()
    const record = await createLockRecord("reflection-scheduler", runId ? { runId } : {})
    signal?.throwIfAborted()
    return withLock(this.schedulerLockPath, record, task, {
      waitTimeoutMs: lockOptions?.waitTimeoutMs ?? 5_000,
      signal,
    })
  }

  private async readStateUnlocked(): Promise<ReservationState> {
    // The scheduler lock excludes every reservation/dream-state writer, so even fresh
    // temporaries here belong to an interrupted operation, not another live write.
    await sweepReservationTemporaries(this.options.identity.paths.reflection, RESERVATION_FILES)
    await sweepReservationTemporaries(join(this.options.identity.paths.runtime, "dream"), ["state.json"])
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
