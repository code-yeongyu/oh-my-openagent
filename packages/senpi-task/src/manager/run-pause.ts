import type { ChildPausePort, EngineHoldInputResult, EngineInheritReceipt, ObservedHold, ResumedChildTurn, RunPauseOwner } from "../pause/ports"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import type { TaskConcurrency } from "./concurrency"
import { ResumeCapacity, type ResumeAllocation } from "./resume-capacity"
import { PendingPauses } from "./pending-pauses"
import type { AdmissionBarrier, ResumeCredential } from "../pause/admission-barrier"
import { buildRevived } from "../steering/engine-policy"
import type { TaskRecord } from "../state"
import { savedRunOwner } from "./paused-restore"

export type ResumeTaskRequest = RunPauseOwner & {
  readonly resumeCredential?: ResumeCredential
  readonly allocation?: ResumeAllocation
  readonly resumeId: string
  readonly childSeqCutoff: number
}

export class RunPauseAdmissionHeld extends Error {
  readonly code = "run_admission_held"
  constructor() { super("the run Resume was superseded by a hold") }
}
export type ResumeTaskResult =
  | { readonly turnId: string }
  | { readonly otherHoldLive: true; readonly childSeq?: number }

export type LostResumeResult = ResumeTaskResult | { readonly notHeld: true }
// `childSeqCutoff` is the hold the run already observed; without it the engine is asked.
export type LostResumeRequest = RunPauseOwner & {
  readonly resumeId: string; readonly resumeCredential?: ResumeCredential; readonly childSeqCutoff?: number
}

export type TaskPauseMethods = {
  pauseTask(taskId: string, owner: RunPauseOwner): Promise<EngineInheritReceipt>
  resumePausedTask(taskId: string, request: ResumeTaskRequest): Promise<ResumeTaskResult>
  holdTaskInput(taskId: string, input: HeldTaskInput): Promise<EngineHoldInputResult>
  observeTaskHold(taskId: string, parentSessionId: string): Promise<ObservedHold | undefined>
  resumeLostTask(taskId: string, request: LostResumeRequest): Promise<LostResumeResult>
}

export type HeldTaskInput = { readonly inputId: string; readonly revision: number; readonly text: string }

export function createTaskRunPause(ports: {
  readonly store: TaskRecordStore
  readonly concurrency: TaskConcurrency
  readonly child?: ChildPausePort
  readonly barrier?: AdmissionBarrier
  readonly now: () => number
  liveHandle(taskId: string): ManagedChildHandle | undefined
  // Rebuild a paused child whose host is gone; it starts no turn (see paused-restore.ts).
  restore?(record: TaskRecord): Promise<ManagedChildHandle>
  track(taskId: string, handle: ManagedChildHandle, model: string, epoch: number, turn: ResumedChildTurn): void
}) {
  const intents = new PendingPauses()
  const capacity = new ResumeCapacity(ports.concurrency)
  const resumed = new Map<string, { readonly resumeId: string; readonly result: ResumeTaskResult }>()
  const attempts = new Map<string, { readonly resumeId: string; readonly cancel: AbortController }>()
  const owners = new Map<string, RunPauseOwner>()

  function park(taskId: string, epoch: number): void {
    capacity.park(taskId, epoch)
    intents.settle(taskId, epoch)
  }

  function childPort(): ChildPausePort {
    if (ports.child === undefined) throw new Error("child pause port is not installed")
    return ports.child
  }

  // The owner is saved on the record so a restarted host re-holds the child under exactly this run.
  function remember(taskId: string, owner: RunPauseOwner): void {
    owners.set(taskId, owner)
    ports.store.mutate(taskId, fresh => ({ ...fresh, run_pause: {
      parent_session_id: owner.parentSessionId, parent_pause_seq: owner.parentPauseSeq, run_ref: owner.runRef,
    } }))
  }

  function load(taskId: string): TaskRecord {
    const record = ports.store.load(taskId)
    if (record === null || record === undefined) throw new Error(`paused child ${taskId} has no record`)
    return record
  }

  async function rehold(record: TaskRecord, owner: RunPauseOwner): Promise<{ readonly handle: ManagedChildHandle; readonly childSeq: number }> {
    if (ports.restore === undefined) throw new Error(`paused child ${record.task_id} has no live handle and no restore port`)
    const handle = await ports.restore(record)
    const ack = await childPort().pauseForRun(handle, owner)
    if ("refused" in ack) throw new Error(`restored child ${record.task_id} is held by another parent`)
    owners.set(record.task_id, owner)
    return { handle, childSeq: ack.childSeq }
  }

  function live(taskId: string) {
    const record = ports.store.load(taskId)
    const handle = ports.liveHandle(taskId)
    if (record === null || record === undefined || handle === undefined) throw new Error(`paused child ${taskId} is not attached`)
    return { record, handle }
  }

  async function pauseTask(taskId: string, owner: RunPauseOwner): Promise<EngineInheritReceipt> {
    const port = childPort()
    const record = load(taskId)
    const handle = ports.liveHandle(taskId)
    const epoch = record.notification.run_epoch
    if (record.status !== "running" && record.status !== "paused") throw new Error(`cannot pause ${record.status} task`)
    if (handle === undefined) {
      // Its host is gone, so nothing runs: record the pause and the run's sequence; the restore that
      // precedes Resume re-holds the child and reads the cutoff from the child's own answer.
      if (record.status === "running" && !ports.store.transition(taskId, { type: "pause", timestamp: new Date(ports.now()).toISOString() }).applied) {
        throw new Error(`child ${taskId} changed while pausing`)
      }
      remember(taskId, owner)
      return { childSeq: 0 }
    }
    const settled = record.status === "paused" ? undefined : intents.begin(taskId, epoch)
    const resuming = attempts.get(taskId)
    resumed.delete(taskId)
    // Registration above MUST precede the child call: its abort can settle immediately.
    let ack: EngineInheritReceipt
    try {
      ack = await port.pauseForRun(handle, owner)
    } catch (error) {
      // The request may have failed after the child's engine took the hold (an RPC timeout):
      // the engine's own hold view, not the failed call, decides whether this child is held.
      const observed = await port.observeHold?.(handle, owner.parentSessionId).catch(() => undefined)
      if (observed?.held !== true) {
        if (settled !== undefined) intents.clear(taskId)
        throw error
      }
      ack = { childSeq: observed.childSeq }
    }
    if ("refused" in ack) {
      intents.clear(taskId)
      return ack
    }
    remember(taskId, owner)
    if (attempts.get(taskId) === resuming) {
      attempts.delete(taskId)
      resuming?.cancel.abort()
      if (record.status === "paused") park(taskId, epoch)
    }
    intents.acknowledge(taskId, epoch)
    if (settled !== undefined) await settled
    return ack
  }

  async function resumePausedTask(taskId: string, request: ResumeTaskRequest): Promise<ResumeTaskResult> {
    const previous = resumed.get(taskId)
    if (previous?.resumeId === request.resumeId) return previous.result
    const port = childPort()
    const record = load(taskId)
    let handle = ports.liveHandle(taskId)
    if (record.status !== "paused") throw new Error(`cannot resume ${record.status} task`)
    const entered = ports.barrier?.enter(record.root_session_id ?? record.parent_session_id,
      { key: taskId, runRef: request.runRef }, request.resumeCredential)
    if (entered?.kind === "held") throw new RunPauseAdmissionHeld()
    const attempt = { resumeId: request.resumeId, cancel: new AbortController() }
    attempts.set(taskId, attempt)
    const assertCurrent = (): void => {
      if (attempts.get(taskId) !== attempt) throw new RunPauseAdmissionHeld()
      if (entered?.ticket.check().kind === "held") {
        park(taskId, record.notification.run_epoch)
        throw new RunPauseAdmissionHeld()
      }
      const current = ports.store.load(taskId)
      if (current?.status !== "paused" || current.notification.run_epoch !== record.notification.run_epoch || ports.liveHandle(taskId) !== handle) {
        park(taskId, record.notification.run_epoch)
        throw new Error("paused task changed while resuming")
      }
    }
    try {
      let childSeqCutoff = request.childSeqCutoff
      if (handle === undefined) {
        const owner = savedRunOwner(record) ?? { parentSessionId: request.parentSessionId, parentPauseSeq: request.parentPauseSeq, runRef: request.runRef }
        const restored = await rehold(record, owner)
        handle = restored.handle
        childSeqCutoff = restored.childSeq
      }
      const acquired = await capacity.acquire(record, attempt.cancel.signal, request.allocation)
      assertCurrent()
      if (!acquired) throw new RunPauseAdmissionHeld()
      const result = await port.resumeTurn(handle, { ...request, childSeqCutoff })
      assertCurrent()
      if ("otherHoldLive" in result) {
        park(taskId, record.notification.run_epoch)
        return result
      }
      intents.clear(taskId)
      const unpaused = ports.store.transition(taskId, { type: "unpause", timestamp: new Date(ports.now()).toISOString() })
      if (!unpaused.applied) throw new Error("paused child changed while resuming")
      owners.delete(taskId)
      ports.store.mutate(taskId, ({ run_pause: _resumed, ...fresh }) => fresh)
      // The returned promise belongs to turnId even when already settled; never waitForOutcome here.
      ports.track(taskId, handle, record.model, record.notification.run_epoch, result)
      const receipt = { turnId: result.turnId }
      resumed.set(taskId, { resumeId: request.resumeId, result: receipt })
      return receipt
    } finally {
      entered?.ticket.leave()
    }
  }

  async function observeTaskHold(taskId: string, parentSessionId: string): Promise<ObservedHold | undefined> {
    const handle = ports.liveHandle(taskId)
    if (handle === undefined) return undefined
    return childPort().observeHold?.(handle, parentSessionId)
  }

  // A child the run recorded as lost may still be held by its engine (the pause failed after the
  // hold landed, or the child recovered). Release it with the cutoff the engine reports now.
  async function resumeLostTask(taskId: string, request: LostResumeRequest): Promise<LostResumeResult> {
    const record = load(taskId)
    if (record.status !== "running" && record.status !== "paused") return { notHeld: true }
    let cutoff = request.childSeqCutoff
    if (cutoff === undefined) {
      const observed = await observeTaskHold(taskId, request.parentSessionId)
      if (observed?.held !== true) return { notHeld: true }
      cutoff = observed.childSeq
    }
    if (record.status === "paused") return resumePausedTask(taskId, { ...request, childSeqCutoff: cutoff })
    const handle = ports.liveHandle(taskId)
    if (handle === undefined) return { notHeld: true }
    const result = await childPort().resumeTurn(handle, { ...request, childSeqCutoff: cutoff })
    if ("otherHoldLive" in result) return result
    ports.track(taskId, handle, record.model, record.notification.run_epoch, result)
    return { turnId: result.turnId }
  }

  // Guidance names the parent that paused this child; the child engine refuses any other parent.
  async function holdTaskInput(taskId: string, input: HeldTaskInput): Promise<EngineHoldInputResult> {
    const port = childPort()
    const record = load(taskId)
    if (record.status !== "paused") throw new Error(`cannot hold input for ${record.status} task`)
    const owner = owners.get(taskId) ?? savedRunOwner(record)
    if (owner === undefined) throw new Error(`paused child ${taskId} has no recorded run owner`)
    const handle = ports.liveHandle(taskId) ?? (await rehold(record, owner)).handle
    return port.holdInput(handle, input, { parentSessionId: owner.parentSessionId })
  }

  // An idle resident child has no turn to abort: its next run is opened paused under the run's
  // owner (a fresh epoch, as a revive would), so the run's Resume starts that turn.
  async function joinIdlePause(taskId: string, owner: RunPauseOwner): Promise<EngineInheritReceipt> {
    const port = childPort()
    const { record, handle } = live(taskId)
    if (record.status !== "completed" && record.status !== "error" && record.status !== "interrupted") {
      throw new Error(`cannot join an idle pause from ${record.status}`)
    }
    const ack = await port.pauseForRun(handle, owner)
    if ("refused" in ack) return ack
    const timestamp = new Date(ports.now()).toISOString()
    let opened = false
    ports.store.mutate(taskId, fresh => {
      if (fresh.status !== record.status || fresh.notification.run_epoch !== record.notification.run_epoch) return fresh
      opened = true
      return buildRevived(fresh, timestamp)
    })
    if (!opened || !ports.store.transition(taskId, { type: "pause", timestamp }).applied) {
      throw new Error(`idle child ${taskId} changed while joining the pause`)
    }
    remember(taskId, owner)
    return ack
  }

  function forget(taskId: string): void {
    owners.delete(taskId)
    intents.clear(taskId)
    const attempt = attempts.get(taskId)
    attempts.delete(taskId)
    attempt?.cancel.abort()
    capacity.forget(taskId)
    resumed.delete(taskId)
  }

  return { pauseTask, resumePausedTask, holdTaskInput, observeTaskHold, resumeLostTask, joinIdlePause, park, forget, settlement: (taskId: string, epoch: number) => intents.settlement(taskId, epoch) }
}
