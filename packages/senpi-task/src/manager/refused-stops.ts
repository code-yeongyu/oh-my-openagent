import { log } from "@oh-my-opencode/utils"

import type { TeardownStep, TeardownStepDeadline } from "../lifecycle/teardown-budget"
import type { TaskRecord, TaskStatus } from "../state"
import type { CancelOutcome, DestructionPort, SendOutcome } from "../steering"
import type { TaskRecordStore } from "../store"
import { discardManagedHandle, type ManagedChildHandle } from "./child-handle"
import { isTerminalRecord } from "./manager-helpers"
import type { OwnerResumeFence } from "./types"

type Disposition = "retire" | "hold"
type Entry = { readonly handle: ManagedChildHandle; disposition: Disposition; inflight?: Promise<boolean> }

export type RefusedStopPorts = {
  readonly store: Pick<TaskRecordStore, "appendEvent">
  readonly deadline: TeardownStepDeadline
  readonly load: (taskId: string) => TaskRecord | undefined
  readonly liveHandle: (taskId: string) => ManagedChildHandle | undefined
  readonly fence?: OwnerResumeFence
  readonly destruction?: DestructionPort
  readonly forget: (taskId: string) => void
}

/**
 * The one fact "this task has a refused self-started turn whose stop is not confirmed yet" (#11381).
 * It is marked in the same synchronous step that refuses the reopen and cleared only when the runner
 * confirms the turn ended: for a hold, the abort settled AND the turn's outcome was observed; for a
 * retire, the teardown settled; either way, or the handle is gone. A timed-out or rejected step leaves
 * it marked, so the run keeps owing the stop and the next attempt - a cancel, a send - tries again.
 */
export class RefusedStops {
  readonly #entries = new Map<string, Entry>()
  readonly #ports: RefusedStopPorts

  constructor(ports: RefusedStopPorts) {
    this.#ports = ports
  }

  mark(taskId: string, handle: ManagedChildHandle, disposition: Disposition): void {
    this.#entries.set(taskId, { handle, disposition })
  }

  pending(taskId: string): boolean {
    return this.#entries.has(taskId)
  }

  /** The manager-side liveness rule: a claim that is not settled, or a refused turn not confirmed stopped. */
  isLive(claim: TaskRecord): boolean {
    return !isTerminalRecord(claim) || this.pending(claim.task_id)
  }

  /** Awaits the stop already in flight and, if it failed, issues a new one; true once the runner confirmed it. */
  async attempt(taskId: string): Promise<boolean> {
    const entry = this.#entries.get(taskId)
    if (entry === undefined) return true
    const joined = entry.inflight
    if (joined !== undefined) {
      if (await joined) return true
      if (entry.inflight !== undefined && entry.inflight !== joined) return entry.inflight
    }
    if (this.#entries.get(taskId) !== entry) return true
    const run = this.#stop(taskId, entry)
    entry.inflight = run
    try {
      return await run
    } finally {
      if (entry.inflight === run) entry.inflight = undefined
    }
  }

  async #stop(taskId: string, entry: Entry): Promise<boolean> {
    const record = this.#ports.load(taskId)
    // A hold whose run has been cancelled or is being cancelled meanwhile is not sendable any more.
    const verdict = record?.owner?.kind === "dag" ? this.#ports.fence?.(record) : undefined
    if (verdict?.kind === "refuse" && verdict.disposition === "retire") entry.disposition = "retire"
    if (this.#ports.liveHandle(taskId) !== entry.handle) return this.#confirm(taskId, entry)
    const failure =
      entry.disposition === "retire"
        ? await this.#within("dispose", () => this.#retire(taskId, entry.handle))
        : ((await this.#within("abort", () => entry.handle.abort())) ??
          (await this.#within("abort", () => entry.handle.waitForOutcome().then(() => undefined))))
    if (failure === undefined) return this.#confirm(taskId, entry)
    this.#ports.store.appendEvent(taskId, {
      type: "task_self_resume_stop_unconfirmed",
      payload: { disposition: entry.disposition, reason: failure },
    })
    log("senpi-task a refused self-started turn is not confirmed stopped; the stop stays owed", { taskId, failure })
    return false
  }

  // A retired refused run: its claim is over, so the child is ended.
  async #retire(taskId: string, handle: ManagedChildHandle): Promise<void> {
    const destruction = this.#ports.destruction
    if (destruction !== undefined) return destruction.destroyResidentTask(taskId, "cancel")
    this.#ports.forget(taskId)
    await discardManagedHandle(handle)
  }

  #confirm(taskId: string, entry: Entry): boolean {
    if (this.#entries.get(taskId) === entry) this.#entries.delete(taskId)
    this.#ports.store.appendEvent(taskId, {
      type: "task_self_resume_stop_confirmed",
      payload: { disposition: entry.disposition },
    })
    return true
  }

  /** Runs one stop step within its budget; the failure to report, or undefined when it completed. */
  async #within(step: TeardownStep, run: () => Promise<void>): Promise<string | undefined> {
    try {
      const outcome = await Promise.race([
        Promise.resolve()
          .then(run)
          .then(() => "done" as const),
        this.#ports.deadline(step).then(() => "timed_out" as const),
      ])
      return outcome === "done" ? undefined : `${step} exceeded its teardown budget`
    } catch (error) {
      return `${step} rejected: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** A cancel of a task with a refused turn stops that turn as its refusal said, never the settled record. */
export async function cancelBehindRefusedStop(
  stops: RefusedStops,
  taskId: string,
  status: () => TaskStatus,
): Promise<CancelOutcome | undefined> {
  if (!stops.pending(taskId)) return undefined
  if (await stops.attempt(taskId)) {
    return {
      kind: "noop",
      task_id: taskId,
      status: status(),
      reason: "its refused self-started turn is confirmed stopped",
    }
  }
  return {
    kind: "cancel_pending",
    task_id: taskId,
    previous_status: status(),
    reason: "refused turn not confirmed stopped",
  }
}

/** Reviving into a refused turn that may still be running is not a revive: the send waits for its stop. */
export async function sendBehindRefusedStop(stops: RefusedStops, taskId: string): Promise<SendOutcome | undefined> {
  if (await stops.attempt(taskId)) return undefined
  const reason = "its self-started turn is not confirmed stopped yet; send again once it is"
  return { kind: "unresponsive", task_id: taskId, retryable: true, reason }
}
