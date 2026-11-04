import { AdmissionBarrier } from "../../pause/admission-barrier"
import type { RunPauseOwner } from "../../pause/ports"
import type { TaskRecord } from "../../state"
import type { TaskRecordStore } from "../../store"
import type { CancelOutcome } from "../../steering/types"
import { defaultControlFsEnv } from "../control-fs"
import type { ControlRegister } from "../control-schema"
import type { ControlOwnerPort } from "../owner-port"

// A child engine with the run-hold rules the owner relies on: a first inherit from any parent is
// accepted, another parent's inherit is refused wrong_parent, and a release must name the high water.
export type FakeEngine = { holder?: string; highWater: number; childSeq: number }

export type FakeOwner = ControlOwnerPort & {
  readonly calls: { pause: number; resume: number; hold: string[]; cancel: CancelOutcome[] }
  readonly engines: Map<string, FakeEngine>
  live: Set<string>
  cancelAnswer?: (taskId: string) => CancelOutcome | undefined
  pauseError?: Error
}

export function fakeOwner(store: TaskRecordStore, hostPid: number, input: { readonly ancestors?: readonly string[] } = {}): FakeOwner {
  const engines = new Map<string, FakeEngine>()
  const engine = (taskId: string): FakeEngine => engines.get(taskId) ?? engines.set(taskId, { highWater: 0, childSeq: 0 }).get(taskId) as FakeEngine
  const load = (taskId: string): TaskRecord | undefined => store.load(taskId) ?? undefined
  const owner: FakeOwner = {
    managerInstance: "owner-b", hostPid, calls: { pause: 0, resume: 0, hold: [], cancel: [] }, engines, live: new Set(),
    barrier: new AdmissionBarrier(),
    sessionId: () => "parent-1",
    holds: taskId => owner.live.has(taskId),
    load,
    ownsRecord: record => record.parent_session_id === "parent-1",
    inAncestry: (record, parent) => record.parent_session_id === parent || (input.ancestors ?? []).includes(parent),
    async pauseTask(taskId: string, run: RunPauseOwner) {
      if (owner.pauseError !== undefined) throw owner.pauseError
      const child = engine(taskId)
      if (child.holder !== undefined && child.holder !== run.parentSessionId) return { refused: "wrong_parent" as const }
      owner.calls.pause += 1
      child.holder = run.parentSessionId
      child.highWater = Math.max(child.highWater, run.parentPauseSeq)
      child.childSeq += 1
      store.mutate(taskId, ({ run_pause_resumed: _gone, ...fresh }) => ({ ...fresh, status: "paused", run_pause: {
        parent_session_id: run.parentSessionId, parent_pause_seq: run.parentPauseSeq, run_ref: run.runRef } }))
      return { childSeq: child.childSeq }
    },
    async holdTaskInput(taskId, input) {
      owner.calls.hold.push(`${taskId}:${input.inputId}`)
      return { kind: "held", entryId: input.inputId, duplicate: false }
    },
    async observeTaskHold(taskId, parent) {
      const child = engine(taskId)
      return { held: child.holder === parent, childSeq: child.childSeq }
    },
    async resumePausedTask(taskId, request) {
      const child = engine(taskId)
      if (child.holder !== request.parentSessionId) throw new Error("child refused the run Resume: wrong_parent")
      if (request.parentPauseSeq !== child.highWater) throw new Error("child refused the run Resume: stale")
      if (request.resumeCredential === undefined && owner.barrier?.state("parent-1").kind !== "open") throw new Error("admission held")
      owner.calls.resume += 1
      child.holder = undefined
      store.mutate(taskId, ({ run_pause: _released, ...fresh }) => ({ ...fresh, status: "running", run_pause_resumed: {
        resume_id: request.resumeId, parent_session_id: request.parentSessionId, parent_pause_seq: request.parentPauseSeq } }))
      return { turnId: `turn-${owner.calls.resume}` }
    },
    async cancelTask(taskId, _reason, options) {
      const scripted = owner.cancelAnswer?.(taskId)
      const record = load(taskId)
      const outcome: CancelOutcome = scripted ?? (options?.expectedRunEpoch !== undefined && record?.notification.run_epoch !== options.expectedRunEpoch
        ? { kind: "stale", task_id: taskId, status: record?.status ?? "running", run_epoch: record?.notification.run_epoch ?? 0, reason: "moved" }
        : { kind: "cancelled", task_id: taskId, previous_status: record?.status ?? "running" })
      if (outcome.kind === "cancelled") store.mutate(taskId, fresh => ({ ...fresh, status: "cancelled" }))
      owner.calls.cancel.push(outcome)
      return outcome
    },
  }
  return owner
}

export function controlFor(store: TaskRecordStore) {
  return { stateDir: store.stateDir, env: defaultControlFsEnv() }
}

export function want(overrides: Partial<ControlRegister> = {}): ControlRegister {
  return {
    version: 1, taskId: "st_00000001", runEpoch: 1, parentSessionId: "parent-1", pauseSeq: 2,
    runRef: { kind: "task", id: "st_00000001" }, phase: "paused",
    requester: { pid: 4242, managerInstance: "requester-a" }, writtenAt: new Date(0).toISOString(), ...overrides,
  }
}
