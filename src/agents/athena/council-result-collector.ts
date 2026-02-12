import type { BackgroundTask, BackgroundTaskStatus } from "../../features/background-agent/types"
import type { CouncilMemberConfig, CouncilMemberResponse, CouncilMemberStatus } from "./types"

export function collectCouncilResults(
  tasks: BackgroundTask[],
  members: CouncilMemberConfig[],
  startTimes: Map<string, number>
): CouncilMemberResponse[] {
  return tasks.map((task, index) => {
    const member = members[index]
    const status = mapTaskStatus(task.status)
    const startTime = startTimes.get(task.id) ?? Date.now()
    const finishedAt = task.completedAt?.getTime() ?? Date.now()

    return {
      member,
      status,
      response: status === "completed" ? task.result : undefined,
      error: status === "completed" ? undefined : (task.error ?? `Task status: ${task.status}`),
      taskId: task.id,
      durationMs: Math.max(0, finishedAt - startTime),
    }
  })
}

function mapTaskStatus(taskStatus: BackgroundTaskStatus): CouncilMemberStatus {
  if (taskStatus === "completed") {
    return "completed"
  }

  if (taskStatus === "cancelled" || taskStatus === "interrupt") {
    return "timeout"
  }

  return "error"
}
