import { log } from "@oh-my-opencode/utils"
import { processOwnerProbe } from "@oh-my-opencode/isolation-core"
import { needsCrashSalvage, salvageCrashedIsolation, sweepIsolations } from "../isolation"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"

export async function reclaimIsolations(context: LifecycleContext): Promise<void> {
  const runtime = context.isolation
  if (runtime === undefined) return
  const records = context.store.list().records
  for (const record of records) {
    if (!needsCrashSalvage(record, (candidate) => TERMINAL_STATUSES.has(candidate.status))) continue
    try {
      await salvageCrashedIsolation({ runtime, stateDir: context.store.stateDir, mutate: context.store.mutate }, record)
    } catch (error) {
      log("senpi-task isolation crash salvage failed", { taskId: record.task_id, error: String(error) })
    }
  }
  try {
    await sweepIsolations(runtime, context.store.list().records, context.isolationProbe ?? processOwnerProbe)
  } catch (error) {
    log("senpi-task isolation sweep failed", { error: String(error) })
  }
}
