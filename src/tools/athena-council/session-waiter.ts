import type { BackgroundManager } from "../../features/background-agent"
import type { CouncilLaunchedMember } from "../../agents/athena/types"

const WAIT_INTERVAL_MS = 100
const WAIT_TIMEOUT_MS = 30_000

interface CouncilSessionInfo {
  taskId: string
  memberName: string
  model: string
  sessionId: string
}

export interface CouncilSessionWaitResult {
  sessions: CouncilSessionInfo[]
  timedOut: boolean
  aborted: boolean
}

/**
 * Waits for background sessions to be created for launched council members.
 * Returns session info for each member whose session became available within the timeout.
 */
export async function waitForCouncilSessions(
  launched: CouncilLaunchedMember[],
  manager: BackgroundManager,
  abort?: AbortSignal
): Promise<CouncilSessionWaitResult> {
  const results: CouncilSessionInfo[] = []
  const pending = new Map(
    launched.map((entry) => [entry.taskId, entry])
  )

  const deadline = Date.now() + WAIT_TIMEOUT_MS
  let timedOut = false
  let aborted = false

  while (pending.size > 0 && Date.now() < deadline) {
    if (abort?.aborted) {
      aborted = true
      break
    }

    for (const [taskId, entry] of pending) {
      const task = manager.getTask(taskId)
      if (task?.sessionID) {
        results.push({
          taskId,
          memberName: entry.member.name ?? entry.member.model,
          model: entry.member.model,
          sessionId: task.sessionID,
        })
        pending.delete(taskId)
      }
    }

    if (pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS))
    }
  }

  if (pending.size > 0 && !aborted) {
    timedOut = true
  }

  return { sessions: results, timedOut, aborted }
}
