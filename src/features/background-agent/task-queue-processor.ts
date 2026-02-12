import { log } from "../../shared"

import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"

type QueueItem = {
  task: BackgroundTask
  input: import("./types").LaunchInput
}

export async function processConcurrencyKeyQueue(args: {
  key: string
  queuesByKey: Map<string, QueueItem[]>
  processingKeys: Set<string>
  concurrencyManager: ConcurrencyManager
  startTask: (item: QueueItem) => Promise<void>
}): Promise<void> {
  const { key, queuesByKey, processingKeys, concurrencyManager, startTask } = args

  if (processingKeys.has(key)) return
  processingKeys.add(key)

  try {
    const queue = queuesByKey.get(key)
    while (queue && queue.length > 0) {
      const item = queue[0]

      await concurrencyManager.acquire(key)

      if (item.task.status === "cancelled" || item.task.status === "error") {
        concurrencyManager.release(key)
        queue.shift()
        continue
      }

      try {
        await startTask(item)
      } catch (error) {
        log("[background-agent] Error starting task:", error)
        // Release concurrency slot if startTask failed and didn't release it itself
        // This prevents slot leaks when errors occur after acquire but before task.concurrencyKey is set
        if (!item.task.concurrencyKey) {
          concurrencyManager.release(key)
        }
      }

      queue.shift()
    }
  } finally {
    processingKeys.delete(key)
  }
}
