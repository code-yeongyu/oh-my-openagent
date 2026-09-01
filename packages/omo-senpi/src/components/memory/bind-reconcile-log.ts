import { LockContentionError } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"

// Bind-time reconcile is opportunistic: it reruns on every session bind, so losing the
// reflection-scheduler lock to a sibling process is a recoverable skip, not a failure.
export function logBindReconcileFailure(logger: ComponentLogger, error: unknown): void {
  if (error instanceof LockContentionError) {
    logger.info("memory bind-time reconcile skipped", {
      reason: "reflection lock contention",
      lockPath: error.lockPath,
    })
    return
  }
  logger.warn("memory bind-time reconcile failed", { error: String(error) })
}
