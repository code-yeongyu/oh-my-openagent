import type { ChildCreationPort, GuardedChild, ResumedChildTurn, RunPauseOwner } from "../pause/ports"
import type { EffectiveModelRecord, ResolvedModelRecord, TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import type { describeStartFailure } from "./start-failure"
import { isAdmissionHeld, type HeldStart } from "./start-admission"
import type { ManagedRunner, ManagedStartSpec, StartResult } from "./types"

export type LaunchContext = {
  readonly record: TaskRecord
  readonly managedSpec: ManagedStartSpec
  readonly runner: ManagedRunner
  readonly model: string
}

export type LaunchOutcome =
  | { readonly ok: true; readonly held?: HeldStart; readonly run_epoch?: number; readonly resolved_model?: ResolvedModelRecord; readonly effective_model?: EffectiveModelRecord; readonly queue_position?: number }
  | {
    readonly ok: false; readonly error: string
    readonly failure_kind?: Extract<StartResult, { kind: "start_failed" }>["failure_kind"]
    readonly failure_reason?: Extract<StartResult, { kind: "start_failed" }>["failure_reason"]
  }

export type LaunchAdvance =
  | { readonly kind: "retry"; readonly context: LaunchContext }
  | { readonly kind: "queued"; readonly runEpoch: number; readonly resolvedModel: ResolvedModelRecord | undefined; readonly queuePosition: number }
  | { readonly kind: "stale" }

export type LaunchPorts = {
  readonly store: TaskRecordStore
  readonly now: () => number
  readonly creation?: ChildCreationPort
  isShuttingDown(): boolean
  release(context: LaunchContext): void
  settleWaiters(taskId: string): void
  dropPending(taskId: string): void
  advance(context: LaunchContext, error: unknown): LaunchAdvance | undefined
  failure(record: TaskRecord, error: unknown): ReturnType<typeof describeStartFailure>
  load(taskId: string): TaskRecord | null | undefined
  owns(context: LaunchContext, record: TaskRecord | null | undefined): boolean
  discard(context: LaunchContext, handle: ManagedChildHandle): Promise<void>
  forget(taskId: string): void
  install(context: LaunchContext, handle: ManagedChildHandle): void
  track(context: LaunchContext, handle: ManagedChildHandle, turn?: ResumedChildTurn): void
  park(context: LaunchContext): void
  paused(context: LaunchContext, owner: RunPauseOwner, childSeq: number): void
}

export async function launchTask(initial: LaunchContext, ports: LaunchPorts): Promise<LaunchOutcome> {
  try {
    initial.managedSpec.admission?.assertOpen()
    return await launchAdmitted(initial, ports)
  } catch (error) {
    if (!isAdmissionHeld(error)) throw error
    const held = initial.managedSpec.admission?.hold() ?? error.result
    ports.release(initial)
    return { ok: true, held }
  } finally {
    initial.managedSpec.admission?.leave()
  }
}

async function launchAdmitted(initial: LaunchContext, ports: LaunchPorts): Promise<LaunchOutcome> {
  if (ports.isShuttingDown()) {
    ports.release(initial)
    return { ok: false, error: "the session is shutting down" }
  }
  const start = ports.store.transition(initial.record.task_id, { type: "start", timestamp: new Date(ports.now()).toISOString() })
  if (!start.applied) {
    ports.release(initial)
    if (start.record.status === "cancelled") ports.dropPending(initial.record.task_id)
    ports.settleWaiters(initial.record.task_id)
    return { ok: false, error: "task was cancelled before launch" }
  }
  let context = initial
  let handle: ManagedChildHandle
  let guarded: GuardedChild | undefined
  for (;;) {
    const { record, managedSpec, runner } = context
    try {
      managedSpec.admission?.assertOpen()
      managedSpec.admission?.creating()
      guarded = ports.creation === undefined || managedSpec.admission === undefined
        ? undefined : await ports.creation.startPaused(managedSpec, runner, managedSpec.admission)
      handle = guarded?.child ?? await runner.start(managedSpec)
      break
    } catch (error) {
      if (isAdmissionHeld(error)) throw error
      const advanced = ports.advance(context, error)
      if (advanced?.kind === "queued") return {
        ok: true, run_epoch: advanced.runEpoch, resolved_model: advanced.resolvedModel, queue_position: advanced.queuePosition,
      }
      if (advanced?.kind === "stale") {
        ports.release(context)
        ports.settleWaiters(record.task_id)
        return { ok: false, error: "task stopped during launch" }
      }
      if (advanced?.kind === "retry") { context = advanced.context; continue }
      return fail(ports, context, error)
    }
  }
  const { record, managedSpec } = context
  const current = ports.load(record.task_id)
  if (!ports.owns(context, current)) {
    await ports.discard(context, handle)
    return { ok: false, error: current?.status === "cancelled" ? "task was cancelled during launch" : "task stopped during launch" }
  }
  ports.install(context, handle)
  let turn: ResumedChildTurn | undefined
  if (guarded !== undefined) {
    try {
      const activation = await guarded.activate()
      if ("kind" in activation) {
        ports.store.transition(record.task_id, { type: "pause", timestamp: new Date(ports.now()).toISOString() })
        ports.park(context)
        ports.paused(context, activation.owner, activation.childSeq)
        if (managedSpec.admission === undefined) throw new Error("guarded child has no admission owner")
        return { ok: true, held: managedSpec.admission.hold() }
      }
      turn = activation
    } catch (error) {
      const failure = fail(ports, context, error)
      await ports.discard(context, handle)
      ports.forget(record.task_id)
      return failure
    }
  }
  ports.track(context, handle, turn)
  const recorded = ports.load(record.task_id)
  return {
    ok: true, run_epoch: record.notification.run_epoch,
    ...(record.resolved_model === undefined ? {} : { resolved_model: record.resolved_model }),
    ...(recorded?.effective_model === undefined ? {} : { effective_model: recorded.effective_model }),
  }
}

function fail(ports: LaunchPorts, context: LaunchContext, error: unknown): LaunchOutcome {
  ports.release(context)
  const failure = ports.failure(context.record, error)
  ports.settleWaiters(context.record.task_id)
  return {
    ok: false, error: failure.errorMessage,
    ...(failure.failureKind === undefined ? {} : { failure_kind: failure.failureKind }),
    ...(failure.failureReason === undefined ? {} : { failure_reason: failure.failureReason }),
  }
}
