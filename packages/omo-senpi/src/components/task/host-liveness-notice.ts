import type { TaskRecord } from "@oh-my-opencode/senpi-task"
import { hostLivenessText, type HostLivenessStatus } from "../../../../senpi-task/src/state/host-liveness"
import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"

/** Session availability is a status notice, not a task completion or permission to re-dispatch. */
export function notifyHostLiveness(
  pi: SenpiExtensionAPI,
  coordinator: IdleInjectionCoordinator | undefined,
  record: TaskRecord,
  status: HostLivenessStatus,
  isStreaming?: () => boolean,
): void {
  const message = {
    customType: "senpi-task.status",
    content: `Task ${record.task_id}: ${hostLivenessText(status)}. Keep the original task; do not re-dispatch it.`,
    display: true,
    details: { task_id: record.task_id, run_epoch: record.notification.run_epoch, ...status },
  }
  if (coordinator === undefined) {
    pi.sendMessage(message, { triggerTurn: true, deliverAs: "steer" })
    return
  }
  coordinator.enqueue({
    ...message,
    key: `task-status:${record.task_id}`,
    source: "task-status",
    runRef: { kind: "task", id: record.task_id },
  })
  if (isStreaming?.() === true) coordinator.scheduleFlush()
  else coordinator.flushSoon()
}
