import { createDagRecovery, type DagRecovery, type DagRecoveryOptions } from "@oh-my-opencode/senpi-task/dag"

import type { TaskEngine } from "./engine"

/**
 * Workflow recovery as the runtime wires it to its engine: the session's ancestry, the lifecycle's
 * answer for a child it still owes a revival (such a node waits for it instead of failing as orphaned,
 * #15150), and one child subscription per reattached task so its progress reaches the surfaces.
 */
export function createRuntimeDagRecovery(
  engine: Pick<TaskEngine, "ancestry" | "lifecycle" | "manager">,
  options: Omit<DagRecoveryOptions, "ancestry" | "pendingRevivals" | "reattach">,
  subscriptions: Map<string, () => void>,
  changed: () => void,
): DagRecovery {
  return createDagRecovery({
    ...options,
    pendingRevivals: engine.lifecycle.pendingRevivals,
    ...(engine.ancestry === undefined ? {} : { ancestry: engine.ancestry }),
    reattach: (runId, taskId) => {
      const key = `${runId}\0${taskId}`
      if (subscriptions.has(key)) return
      subscriptions.set(key, engine.manager.subscribeChild(taskId, changed))
    },
  })
}
