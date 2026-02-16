import type { McbToolAvailability } from "./types"
import { getMcbAvailability, markMcbUnavailable } from "./availability"
import type { QueuedMcbOperation } from "./sync-queue-types"
import { enqueueOperation } from "./sync-queue"
import { emitMcbDegradationWarning } from "./degradation-warnings"

export type McbOperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; degraded: true; queued?: boolean }

export async function withMcbFallback<T>(
  operation: () => Promise<T>,
  toolName?: keyof McbToolAvailability,
  queueDescriptor?: Omit<QueuedMcbOperation, "id" | "queuedAt" | "retryCount">,
  projectDir?: string,
): Promise<McbOperationResult<T>> {
  const queueForLaterSync = async (): Promise<boolean> => {
    if (!queueDescriptor || !projectDir) {
      return false
    }

    await enqueueOperation(projectDir, {
      ...queueDescriptor,
      id: crypto.randomUUID(),
      queuedAt: Date.now(),
      retryCount: 0,
    })

    return true
  }

  const status = getMcbAvailability()

  if (!status.available) {
    if (toolName) {
      emitMcbDegradationWarning(toolName)
    }
    const queued = await queueForLaterSync()
    return { success: false, error: "MCB unavailable", degraded: true, queued }
  }

  if (toolName && !status.tools[toolName]) {
    emitMcbDegradationWarning(toolName)
    const queued = await queueForLaterSync()
    return {
      success: false,
      error: `MCB tool ${toolName} unavailable`,
      degraded: true,
      queued,
    }
  }

  try {
    const data = await operation()
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (toolName) {
      markMcbUnavailable(toolName)
      emitMcbDegradationWarning(toolName)
    }
    const queued = await queueForLaterSync()
    return { success: false, error: message, degraded: true, queued }
  }
}
