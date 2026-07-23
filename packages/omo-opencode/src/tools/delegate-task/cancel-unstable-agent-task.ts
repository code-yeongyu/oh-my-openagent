import type { ExecutorContext } from "./executor-types"

export async function cancelUnstableAgentTask(
  manager: ExecutorContext["manager"],
  taskID: string | undefined,
  reason: string
): Promise<void> {
  if (!taskID || typeof manager.cancelTaskForCleanup !== "function") {
    return
  }

  await Promise.allSettled([
    manager.cancelTaskForCleanup(taskID, {
      source: "unstable-agent-task",
      reason,
      skipNotification: true,
    }),
  ])
}
