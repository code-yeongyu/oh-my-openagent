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
 * Extracts result data from a BackgroundTask for compression.
 */
export function extractTaskResultData(task: BackgroundTask): TaskResultData {
  return {
    taskId: task.id,
    description: task.description,
    status: task.status,
    sessionID: task.sessionID,
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
