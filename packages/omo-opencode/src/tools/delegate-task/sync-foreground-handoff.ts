import type { BackgroundManager } from "../../features/background-agent"
import { syncSubagentSessions } from "../../features/claude-code-session-state"
import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import { log } from "../../shared/logger"
import { formatDuration } from "./time-formatter"

/** What a handoff needs of the foreground call's arguments. */
export type HandoffArgs = {
  readonly description: string
  readonly wake?: "each" | "none"
  readonly category?: string
}

/** What pollSyncSession returns when the foreground wait was handed off; never shown to the model. */
export const SYNC_POLL_HANDED_OFF = "[omo:sync-poll-handed-off]"

export type ForegroundHandoffTimer = {
  /** Aborts once the handoff threshold has elapsed; absent when handoff is off. */
  readonly signal?: AbortSignal
  readonly cancel: () => void
}

/** Starts the clock after which a foreground child is handed to the background; `0` or unset turns handoff off. */
export function startForegroundHandoffTimer(handoffMs: number | undefined): ForegroundHandoffTimer {
  if (handoffMs === undefined || handoffMs <= 0) return { cancel: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), handoffMs)
  timer.unref?.()
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

/**
 * Adopts a still-running foreground child as a background task under the same task id. The child is neither aborted
 * nor prompted again; from here on the background manager watches it and its completion notice wakes the parent.
 */
export async function handOffSyncTask(input: {
  readonly manager: BackgroundManager
  readonly taskId: string
  readonly sessionID: string
  readonly parentSessionID: string
  readonly parentAgent: string | undefined
  readonly args: HandoffArgs
  readonly agentToUse: string
  readonly startTime: Date
}): Promise<string> {
  const task = await input.manager.adoptForegroundSession({
    taskId: input.taskId,
    sessionId: input.sessionID,
    parentSessionId: input.parentSessionID,
    description: input.args.description,
    agent: input.agentToUse,
    parentAgent: input.parentAgent,
    wake: input.args.wake ?? "each",
    startedAt: input.startTime,
  })
  syncSubagentSessions.delete(input.sessionID)
  log("[task] Foreground task handed off to the background", { taskId: input.taskId, sessionID: input.sessionID })

  return `Task is still running after ${formatDuration(input.startTime)}, so it moved to the background as \`${task.id}\`. It was not stopped or restarted; it keeps working on the same prompt.

Its result arrives as a background task notification${task.wake === "none" ? " on your next turn" : ", which starts your next turn"}. Do not poll.
- Read its progress: \`background_output(task_id="${task.id}")\`
- Stop it: \`background_cancel(taskId="${task.id}")\`
- Give it more instructions once it has finished: \`task(task_id="${input.sessionID}", prompt="...")\`

${buildTaskMetadataBlock({
  sessionId: input.sessionID,
  taskId: input.sessionID,
  backgroundTaskId: task.id,
  agent: input.agentToUse,
  category: input.args.category,
})}`
}
