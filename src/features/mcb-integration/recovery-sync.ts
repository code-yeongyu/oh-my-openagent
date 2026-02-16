import { log } from "../../shared/logger"
import { markMcbAvailable } from "./availability"
import { evictStaleEntries, peekQueue, saveQueue } from "./sync-queue"
import type { QueuedMcbOperation } from "./sync-queue-types"

export interface RecoverySyncResult {
  replayed: number
  failed: number
  discarded: number
}

export type McbOperationExecutor = (operation: QueuedMcbOperation) => Promise<void>

export async function attemptRecoverySync(
  projectDir: string,
  executor: McbOperationExecutor,
): Promise<RecoverySyncResult> {
  const result: RecoverySyncResult = { replayed: 0, failed: 0, discarded: 0 }

  await evictStaleEntries(projectDir)
  const queue = await peekQueue(projectDir)
  if (queue.length === 0) {
    return result
  }

  const remaining: QueuedMcbOperation[] = []

  for (const operation of queue) {
    try {
      await executor(operation)
      markMcbAvailable(operation.tool)
      result.replayed++
    } catch {
      const nextRetryCount = operation.retryCount + 1
      result.failed++
      if (nextRetryCount >= operation.maxRetries) {
        result.discarded++
        continue
      }
      remaining.push({
        ...operation,
        retryCount: nextRetryCount,
      })
    }
  }

  await saveQueue(projectDir, remaining)
  log("[mcb] Recovery sync completed", result)
  return result
}
