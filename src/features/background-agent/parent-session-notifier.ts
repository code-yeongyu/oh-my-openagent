import type { ToonCompressionConfig } from "../../config/schema/toon-compression"
import type { BackgroundTask } from "./types"
import { safeCompress } from "../../shared/toon-compression"

/**
 * Result data extracted from a background task for parent notification.
 */
export interface TaskResultData {
  taskId: string
  description: string
  status: string
  sessionID?: string
  duration?: string
  error?: string
  result?: string
}

/**
 * Computes duration string from start and end dates.
 * Returns undefined if either date is missing.
 */
function computeDuration(startedAt?: Date, completedAt?: Date): string | undefined {
  if (!startedAt || !completedAt) {
    return undefined
  }

  const diffMs = completedAt.getTime() - startedAt.getTime()
  if (diffMs < 0) {
    return undefined
  }

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

/**
 * Extracts result data from a BackgroundTask for compression.
 */
export function extractTaskResultData(task: BackgroundTask): TaskResultData {
  const duration = computeDuration(task.startedAt, task.completedAt)

  return {
    taskId: task.id,
    description: task.description,
    status: task.status,
    sessionID: task.sessionID,
    duration,
    error: task.error,
    result: task.result,
  }
}

/**
 * Compresses task result data for efficient transmission to parent session.
 * Uses TOON format compression when enabled and data exceeds threshold.
 */
export function compressTaskResult(
  data: TaskResultData,
  config: ToonCompressionConfig
): string {
  return safeCompress(data, config)
}

/**
 * Compresses an array of task results for batch notification.
 */
export function compressTaskResults(
  tasks: BackgroundTask[],
  config: ToonCompressionConfig
): string {
  const results = tasks.map(extractTaskResultData)
  return safeCompress(results, config)
}

/**
 * Formats a compressed notification message for parent session.
 * Returns the compressed data wrapped in a system-reminder block.
 */
export function formatCompressedNotification(
  compressedData: string,
  taskCount: number
): string {
  return `<system-reminder>
[BACKGROUND TASK RESULTS - COMPRESSED]

**Tasks:** ${taskCount}
**Format:** TOON (compressed)

\`\`\`toon
${compressedData}
\`\`\`

Use background_output to retrieve individual task results.
</system-reminder>`
}
