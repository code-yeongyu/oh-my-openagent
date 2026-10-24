import { log } from "@oh-my-opencode/utils"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import type { RunPauseController } from "../../../../senpi-task/src/pause/run-controller"
import { readEngineRunHold } from "./engine-hold-reader"

export type RunHoldChange = EnginePauseState & { readonly change: "paused" | "resumed" }

export class EngineRunPauseBridge {
  readonly #pauses = new Map<string, { readonly seq: number; readonly pending: Promise<void> }>()
  readonly #resumes = new Map<string, { readonly seq: number; readonly pending: Promise<void> }>()
  readonly #retries = new Map<string, Promise<void>>()

  constructor(
    readonly controller: RunPauseController,
    readonly native: { getPauseState(): EnginePauseState | undefined },
    readonly afterReleased?: (parentSessionId: string) => void | Promise<void>,
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
    if (event.change === "resumed" && !live.stopped) return this.#resume(parentSessionId, event.pauseSeq)
    return Promise.resolve()
  }

  #pause(parentSessionId: string, pauseSeq: number): Promise<void> {
    const existing = this.#pauses.get(parentSessionId)
    if (existing?.seq === pauseSeq) return existing.pending
    const pending = this.controller.pause(parentSessionId, pauseSeq)
    const entry = { seq: pauseSeq, pending }
    this.#pauses.set(parentSessionId, entry)
    void pending.catch(() => { if (this.#pauses.get(parentSessionId) === entry) this.#pauses.delete(parentSessionId) })
    // Keep the fulfilled propagation promise until the next Stop so a Resume racing
    // the final acknowledgement observes the same completed transaction.
    return pending
  }

  #resume(parentSessionId: string, pauseSeq: number): Promise<void> {
    const existing = this.#resumes.get(parentSessionId)
    // A repeated Resume at the same Stop retries the participants the first one could not resume.
    if (existing?.seq === pauseSeq) return existing.pending.then(() => this.#retryLost(parentSessionId, pauseSeq))
    const pending = this.#resumeAfterPropagation(parentSessionId, pauseSeq)
    const entry = { seq: pauseSeq, pending }
    this.#resumes.set(parentSessionId, entry)
    void pending.catch(() => { if (this.#resumes.get(parentSessionId) === entry) this.#resumes.delete(parentSessionId) })
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
      log("[omo-senpi] run resume left participants outside the run", { parentSessionId, pauseSeq, failures: installed.failures })
    }
    if (installed.kind === "installed" && this.controller.released(parentSessionId, pauseSeq, resumeId)) await this.afterReleased?.(parentSessionId)
  }

  // Serialized per parent, so overlapping retries never resume the same child twice.
  #retryLost(parentSessionId: string, pauseSeq: number): Promise<void> {
    const previous = this.#retries.get(parentSessionId) ?? Promise.resolve()
    const next = previous.then(async () => {
      const failures = await this.controller.retryLost(parentSessionId, pauseSeq)
      if (failures.length > 0) log("[omo-senpi] run resume retry left participants outside the run", { parentSessionId, pauseSeq, failures })
    })
    const settled = next.catch(() => undefined)
    this.#retries.set(parentSessionId, settled)
    void settled.then(() => { if (this.#retries.get(parentSessionId) === settled) this.#retries.delete(parentSessionId) })
    return next
  }
}

export function isRunHoldChange(value: unknown): value is RunHoldChange {
  if (typeof value !== "object" || value === null) return false
  if (!("pauseSeq" in value) || !Number.isSafeInteger(value.pauseSeq) || typeof value.pauseSeq !== "number" || value.pauseSeq < 1) return false
  if (!("change" in value) || (value.change !== "paused" && value.change !== "resumed")) return false
  return "holds" in value && Array.isArray(value.holds) && value.holds.every(hold =>
    typeof hold === "object" && hold !== null && "kind" in hold && typeof hold.kind === "string"
    && "key" in hold && typeof hold.key === "string")
}
