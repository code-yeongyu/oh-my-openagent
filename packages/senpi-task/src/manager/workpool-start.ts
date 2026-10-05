import { createTaskRecord, type TaskRecord } from "../state"
import { WorkpoolError, type WorkpoolSpec } from "../workpool/types"
import { buildManagedSpec, buildRecordInput, buildSpawnSpecV1 } from "./manager-helpers"
import type { ManagedRunner, ManagedStartSpec, ManagerStartSpec, TaskManagerOptions } from "./types"

export type WorkpoolLaunch = {
  readonly record: TaskRecord
  readonly managedSpec: ManagedStartSpec
  readonly runner: ManagedRunner
  readonly model: string
}

// Called only under the manager's granted lane and session residency admission lease.
// The exclusive save preserves the exact task ID to which the allocator granted that lane.
export function prepareWorkpoolLaunch(input: {
  readonly options: TaskManagerOptions
  readonly workerSpec: WorkpoolSpec
  readonly spec: ManagerStartSpec
  readonly taskId: string
  readonly taskSeq: number
  readonly hostPid: number
}): WorkpoolLaunch {
  const { options, workerSpec, spec, taskId } = input
  const executionMode = workerSpec.start.execution_mode
  if (executionMode === undefined) throw new WorkpoolError("store_corrupt", "Worker execution mode was not resolved.")
  const prior = options.store.load(taskId)
  if (prior !== null && (prior.status !== "pending" || prior.started_at !== undefined || prior.parent_session_id !== spec.parent_session_id)) {
    throw new WorkpoolError("delivery_uncertain", "An existing worker launch cannot be replayed.")
  }
  const draft = prior ?? createTaskRecord(buildRecordInput({ spec, plan: workerSpec.plan, name: taskId, executionMode, taskSeq: input.taskSeq }))
  const claimed = { ...draft, task_id: taskId, host_pid: input.hostPid, notify_on_terminal: false }
  const managedSpec = buildManagedSpec({ record: claimed, spec, plan: workerSpec.plan, cwd: options.cwd, stateDir: options.store.stateDir })
  const record = { ...claimed, spawn_spec: buildSpawnSpecV1(managedSpec) }
  if (prior === null) options.store.save(record)
  return { record, managedSpec, runner: options.runners[executionMode], model: record.model }
}
