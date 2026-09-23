import { dirname } from "node:path"

import type { TaskRecord } from "../state"
import { settleIsolation } from "./settle"
import type { IsolationRuntime, OwnerProbe, SweepResult } from "./runtime"

export type SalvagePorts = {
  readonly runtime: IsolationRuntime
  readonly stateDir: string
  readonly mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord) => unknown
}

export function needsCrashSalvage(record: TaskRecord, terminal: (record: TaskRecord) => boolean): boolean {
  return record.isolation !== undefined && record.isolation.merge_result === undefined && terminal(record)
}

/**
 * A host that died mid-run never got to judge the child's work, so its delta is captured as
 * artifacts and NEVER auto-merged: replaying an unreviewed child's edits into the checkout on the
 * next startup is exactly the surprise isolation exists to prevent.
 */
export async function salvageCrashedIsolation(ports: SalvagePorts, record: TaskRecord): Promise<void> {
  const isolation = record.isolation
  if (isolation === undefined) return
  const merge_result = await settleIsolation({
    runtime: ports.runtime,
    stateDir: ports.stateDir,
    taskId: record.task_id,
    isolation,
    merge: false,
    reason: "host_crashed",
  })
  ports.mutate(record.task_id, (fresh) =>
    fresh.isolation === undefined ? fresh : { ...fresh, isolation: { ...fresh.isolation, merge_result } })
}

export function sweepRootsFor(runtime: IsolationRuntime, records: readonly TaskRecord[]): readonly string[] {
  const roots = new Set<string>(runtime.sweepRoots)
  for (const record of records) {
    if (record.isolation !== undefined) roots.add(dirname(record.isolation.base_dir))
  }
  return [...roots]
}

export function sweepIsolations(
  runtime: IsolationRuntime,
  records: readonly TaskRecord[],
  probe: OwnerProbe,
): Promise<SweepResult> {
  return runtime.sweep(sweepRootsFor(runtime, records), probe)
}
