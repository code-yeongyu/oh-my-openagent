import { log } from "@oh-my-opencode/utils"

import type { TaskStatus } from "../state"
import type { ManagedChildHandle } from "./child-handle"

/**
 * Publish a daemon-hosted child's terminal record status in its session's context (`task_status`) the
 * moment the record turns terminal, without holding the caller on the host: a parent that crashes before it detaches
 * a finished child must still leave the session marked, so a successor host drops it instead of
 * reopening it unattended (omo#10778). The detach-time publish in `suspendHandle` is the backstop.
 */
export function publishHostTaskStatus(handle: ManagedChildHandle | undefined, taskId: string, status: TaskStatus | undefined): void {
  if (handle?.publishTaskStatus === undefined || status === undefined) return
  void handle.publishTaskStatus(status).catch((error: unknown) => {
    log("senpi-task host task_status publish failed", { taskId, status, error: String(error) })
  })
}
