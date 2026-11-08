import { LockContentionError } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"

const STALE_EXTENSION_CONTEXT_PREFIX = "This extension ctx is stale after session replacement or reload."

function isSupersededBind(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_EXTENSION_CONTEXT_PREFIX)
}

// Bind-time reconcile is opportunistic: it reruns on every session bind, so losing the
// reflection-scheduler lock to a sibling process is a recoverable skip, not a failure.
// A session replaced while the bind was still in flight is the same category: the host
// retired the ctx this bind was handed, and the replacement session runs its own bind.
export function logBindReconcileFailure(logger: ComponentLogger, error: unknown): void {
  if (error instanceof LockContentionError) {
    logger.info("memory bind-time reconcile skipped", {
      reason: "reflection lock contention",
      lockPath: error.lockPath,
    })
    return
  }
  if (isSupersededBind(error)) {
    logger.info("memory bind-time reconcile skipped", {
      reason: "session replaced before the bind completed",
    })
    return
  }
  logger.warn("memory bind-time reconcile failed", { error: String(error) })
}
