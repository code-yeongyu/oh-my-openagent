import type { ExecutorContext } from "./executor-types"

export async function cancelUnstableAgentTask(
  manager: ExecutorContext["manager"],
  taskID: string | undefined,
  reason: string
): Promise<void> {
  if (!taskID || typeof manager.cancelTask !== "function") {
    return
  }

  await Promise.allSettled([
    manager.cancelTask(taskID, {
      source: "unstable-agent-task",
      reason,
      skipNotification: true,
    }),
  ])
}
