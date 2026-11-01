import type { ManagedChildHandle } from "./child-handle"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { RespawnResult, ReattachResult } from "../lifecycle/port"
import { newestSessionPath } from "../lifecycle/session-path"
import { routeAroundSpentLimits, type UsageLimitMemory } from "./usage-limit-memory"

export type PreparedLimitRevival =
  | { readonly record: TaskRecord; readonly handle: ManagedChildHandle }
  | { readonly refused: string; readonly failure_kind: "usage_limit" | "session_unavailable" }

/** A warm terminal session needs the same route admission as a cold resumed session. */
export async function prepareLimitRevival(
  record: TaskRecord,
  handle: ManagedChildHandle,
  ports: {
    readonly limits: UsageLimitMemory
    readonly store: TaskRecordStore
    close(): Promise<void>
    forget(): void
    respawn(record: TaskRecord, path: string): Promise<RespawnResult>
    reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult>
  },
): Promise<PreparedLimitRevival> {
  const routed = routeAroundSpentLimits(record, ports.limits)
  if ("spent" in routed) return { refused: routed.spent, failure_kind: "usage_limit" }
  if (routed.plan === record) return { record, handle }
  const path = record.host_session?.session_path ?? newestSessionPath(ports, record.task_id)
  if (path === undefined) return { refused: "The session transcript is unavailable for a limit-routing revival.", failure_kind: "session_unavailable" }
  try {
    await ports.close()
    ports.forget()
    let claimed = false
    const updated = ports.store.mutate(record.task_id, fresh => {
      if (fresh.host_pid !== record.host_pid || fresh.status !== record.status || fresh.notification.run_epoch !== record.notification.run_epoch || fresh.killed === true) return fresh
      claimed = true
      return { ...fresh, model: routed.plan.model, resolved_model: routed.plan.resolved_model, fallback_models: routed.plan.fallback_models, residency_state: "resident" }
    })
    if (!claimed || updated === null) return { refused: "The task changed before its limit-routing revival.", failure_kind: "session_unavailable" }
    const resumed = await ports.respawn(updated, path)
    if (!resumed.ok) return { refused: resumed.reason, failure_kind: "session_unavailable" }
    const attached = await ports.reattach(updated, resumed.handle)
    if (!attached.ok) return { refused: attached.reason, failure_kind: "session_unavailable" }
    return { record: ports.store.load(record.task_id) ?? updated, handle: resumed.handle }
  } catch (error) {
    return { refused: `The session could not be rerouted: ${error instanceof Error ? error.message : String(error)}`, failure_kind: "session_unavailable" }
  }
}
