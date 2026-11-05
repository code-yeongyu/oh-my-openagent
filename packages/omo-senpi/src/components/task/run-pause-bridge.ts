import { log } from "@oh-my-opencode/utils"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import type { RunPauseController } from "../../../../senpi-task/src/pause/run-controller"
import { readEngineRunHold } from "./engine-hold-reader"

export type RunHoldChange = EnginePauseState & { readonly change: "paused" | "resumed" }

// After a released Resume left participants outside the run, they are retried after each delay;
// whatever is still lost after the last one has its run ended (#12249).
export type LostParticipantRecovery = {
  readonly delaysMs: readonly number[]
  readonly sleep: (ms: number) => Promise<void>
}

export class EngineRunPauseBridge {
  readonly #pauses = new Map<string, { readonly seq: number; readonly pending: Promise<void> }>()
  readonly #resumes = new Map<string, { readonly seq: number; readonly pending: Promise<void>; settled: boolean }>()
  readonly #retries = new Map<string, Promise<void>>()
  readonly #recoveries = new Map<string, Promise<void>>()

  constructor(
    readonly controller: RunPauseController,
    readonly native: { getPauseState(): EnginePauseState | undefined },
    readonly afterReleased?: (parentSessionId: string) => void | Promise<void>,
    readonly lostRecovery?: LostParticipantRecovery,
  ) {}

  async restore(parentSessionId: string): Promise<void> {
    const registry = this.controller.registry
    const persisted = registry.load(parentSessionId)
    const state = this.native.getPauseState()
    const live = state === undefined ? undefined : readEngineRunHold(state)
    if (persisted === undefined && live?.stopped !== true) return
    const pauseSeq = Math.max(persisted?.pauseSeq ?? 0, live?.pauseSeq ?? 0)
    registry.restore(parentSessionId, {
      pauseSeq,
      rebuild: () => this.controller.effects.snapshot(parentSessionId, registry.barrier.inFlight(parentSessionId)),
    })
  }

  async reconciled(parentSessionId: string): Promise<void> {
    const registry = this.controller.registry
    const record = registry.load(parentSessionId)
    if (record === undefined) return
    const state = this.native.getPauseState()
    if (state === undefined) return
    const live = readEngineRunHold(state)
    const pauseSeq = record.pauseSeq
    if (record.phase === "resumed" && !live.stopped) return this.#retryLost(parentSessionId, pauseSeq)
    // Only an authoritative engine ledger at this epoch proves that the user's Stop
    // was released. An absent/old context must not turn a restart into Resume.
    if (!live.stopped && live.pauseSeq === pauseSeq) return this.#resume(parentSessionId, pauseSeq)
    await this.#pause(parentSessionId, pauseSeq)
  }

  changed(parentSessionId: string, event: RunHoldChange): Promise<void> {
    const state = this.native.getPauseState()
    if (state !== undefined && state.pauseSeq > event.pauseSeq) return Promise.resolve()
    const live = readEngineRunHold(event)
    if (event.change === "paused" && live.stopped) return this.#pause(parentSessionId, event.pauseSeq)
    if (event.change !== "resumed" || live.stopped) return Promise.resolve()
    // The Stop's run fences are engine holds too, so the Resume event carries a seq past the Stop it
    // releases (#12249). It releases the run's Stop at or below that seq, never a newer one.
    const stop = this.controller.registry.load(parentSessionId)?.pauseSeq
    return this.#resume(parentSessionId, stop !== undefined && stop <= event.pauseSeq ? stop : event.pauseSeq)
  }

  // A Resume the bridge never acted on (#12249 on an older build, or a lost hold-change event) leaves the
  // run's Stop applied while the engine holds no Stop at all, so nothing would ever release it. When the
  // engine's live ledger is at or past the recorded Stop and holds no user Stop, that Stop was released.
  // Only a Stop left `applied` with no Resume in flight is stale: a Resume `changed()` already started (the
  // ordinary Stop-then-message path) or a `resuming` ledger is left to the path that owns it.
  releaseStale(parentSessionId: string): Promise<void> {
    const record = this.controller.registry.load(parentSessionId)
    if (record === undefined || record.phase !== "applied") return Promise.resolve()
    const inFlight = this.#resumes.get(parentSessionId)
    if (inFlight?.seq === record.pauseSeq && !inFlight.settled) return Promise.resolve()
    const state = this.native.getPauseState()
    if (state === undefined || state.pauseSeq < record.pauseSeq || readEngineRunHold(state).stopped)
      return Promise.resolve()
    return this.#resume(parentSessionId, record.pauseSeq)
  }

  #pause(parentSessionId: string, pauseSeq: number): Promise<void> {
    const existing = this.#pauses.get(parentSessionId)
    if (existing?.seq === pauseSeq) return existing.pending
    const pending = this.controller.pause(parentSessionId, pauseSeq)
    const entry = { seq: pauseSeq, pending }
    this.#pauses.set(parentSessionId, entry)
    void pending.catch(() => {
      if (this.#pauses.get(parentSessionId) === entry) this.#pauses.delete(parentSessionId)
    })
    // Keep the fulfilled propagation promise until the next Stop so a Resume racing
    // the final acknowledgement observes the same completed transaction.
    return pending
  }

  #resume(parentSessionId: string, pauseSeq: number): Promise<void> {
    const existing = this.#resumes.get(parentSessionId)
    // A repeated Resume at the same Stop retries the participants the first one could not resume.
    if (existing?.seq === pauseSeq) return existing.pending.then(() => this.#retryLost(parentSessionId, pauseSeq))
    const pending = this.#resumeAfterPropagation(parentSessionId, pauseSeq)
    const entry = { seq: pauseSeq, pending, settled: false }
    this.#resumes.set(parentSessionId, entry)
    void pending.then(
      () => {
        entry.settled = true
      },
      () => {
        entry.settled = true
        if (this.#resumes.get(parentSessionId) === entry) this.#resumes.delete(parentSessionId)
      },
    )
    return pending
  }

  async #resumeAfterPropagation(parentSessionId: string, pauseSeq: number): Promise<void> {
    const registry = this.controller.registry
    const before = registry.load(parentSessionId)
    if (before === undefined || before.pauseSeq !== pauseSeq) return
    if (before.phase === "resumed") return this.#retryLost(parentSessionId, pauseSeq)
    // Resume still runs after a failed propagation, so admission reopens; the failure is logged and
    // kept as the reason each unacknowledged participant left the run's custody.
    await this.#pause(parentSessionId, pauseSeq).catch((error: unknown) => {
      this.controller.recordPropagationFailure(parentSessionId, pauseSeq, error)
    })
    const record = registry.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq) return
    const resumeId = record.resume?.resumeId ?? `parent-resume:${pauseSeq}`
    const installed = await this.controller.resume(parentSessionId, pauseSeq, resumeId)
    if (installed.failures !== undefined) {
      log("[omo-senpi] run resume left participants outside the run", {
        parentSessionId,
        pauseSeq,
        failures: installed.failures,
      })
    }
    if (installed.kind === "installed" && this.controller.released(parentSessionId, pauseSeq, resumeId)) {
      await this.afterReleased?.(parentSessionId)
      // Backgrounded: the hold-change handler must not wait out the retry schedule.
      if (this.lostRecovery !== undefined && this.controller.hasLost(parentSessionId, pauseSeq)) {
        const recovery = this.#recoverLost(parentSessionId, pauseSeq, this.lostRecovery).catch((error: unknown) => {
          log("[omo-senpi] run resume lost-participant recovery failed", {
            parentSessionId,
            pauseSeq,
            error: String(error),
          })
        })
        this.#recoveries.set(parentSessionId, recovery)
        void recovery.then(() => {
          if (this.#recoveries.get(parentSessionId) === recovery) this.#recoveries.delete(parentSessionId)
        })
      }
    }
  }

  async #recoverLost(parentSessionId: string, pauseSeq: number, recovery: LostParticipantRecovery): Promise<void> {
    for (const delayMs of recovery.delaysMs) {
      await recovery.sleep(delayMs)
      if (!this.controller.hasLost(parentSessionId, pauseSeq)) return
      await this.#retryLost(parentSessionId, pauseSeq)
      if (!this.controller.hasLost(parentSessionId, pauseSeq)) return
    }
    await this.#serialized(parentSessionId, async () => {
      const failures = await this.controller.endLost(parentSessionId, pauseSeq)
      if (failures.length > 0)
        log("[omo-senpi] run resume could not end lost participants", { parentSessionId, pauseSeq, failures })
    })
  }

  /** Test observability: the parent's in-flight lost-child recovery, settled once every lost child is resumed or ended. */
  lostRecoverySettled(parentSessionId: string): Promise<void> {
    return this.#recoveries.get(parentSessionId) ?? Promise.resolve()
  }

  #retryLost(parentSessionId: string, pauseSeq: number): Promise<void> {
    return this.#serialized(parentSessionId, async () => {
      const failures = await this.controller.retryLost(parentSessionId, pauseSeq)
      if (failures.length > 0)
        log("[omo-senpi] run resume retry left participants outside the run", { parentSessionId, pauseSeq, failures })
    })
  }

  // Serialized per parent, so overlapping retries and the final end never act on the same child at once.
  #serialized(parentSessionId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.#retries.get(parentSessionId) ?? Promise.resolve()
    const next = previous.then(work)
    const settled = next.catch(() => undefined)
    this.#retries.set(parentSessionId, settled)
    void settled.then(() => {
      if (this.#retries.get(parentSessionId) === settled) this.#retries.delete(parentSessionId)
    })
    return next
  }
}

export function isRunHoldChange(value: unknown): value is RunHoldChange {
  if (typeof value !== "object" || value === null) return false
  if (
    !("pauseSeq" in value) ||
    !Number.isSafeInteger(value.pauseSeq) ||
    typeof value.pauseSeq !== "number" ||
    value.pauseSeq < 1
  )
    return false
  if (!("change" in value) || (value.change !== "paused" && value.change !== "resumed")) return false
  return (
    "holds" in value &&
    Array.isArray(value.holds) &&
    value.holds.every(
      (hold) =>
        typeof hold === "object" &&
        hold !== null &&
        "kind" in hold &&
        typeof hold.kind === "string" &&
        "key" in hold &&
        typeof hold.key === "string",
    )
  )
}
