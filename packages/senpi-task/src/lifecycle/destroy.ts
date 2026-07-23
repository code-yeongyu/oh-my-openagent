import { log } from "@oh-my-opencode/utils"

import { nowIso, type LifecycleContext } from "./context"
import type { DestroyCause, ResidentHandle } from "./port"

export class ResidentTaskDisposalError extends Error {
  readonly cause: unknown

  constructor(taskId: string, cause: unknown) {
    super(`Failed to dispose resident task: ${taskId}`)
    this.name = "ResidentTaskDisposalError"
    this.cause = cause
  }
}

/**
 * THE single-writer destruction port. This is the ONLY function in the package that invokes a
 * handle's dispose()/terminate(). Cancel,
 * LRU eviction, TTL, session shutdown, and reconciliation all route here so terminal state never
 * auto-disposes and every teardown is bookkept identically.
 */
export async function destroyResidentTask(
  context: LifecycleContext,
  taskId: string,
  cause: DestroyCause,
): Promise<void> {
  const handle = context.registry.get(taskId)
  if (handle !== undefined) {
    let disposalFailure: unknown
    try {
      await teardownHandle(handle)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      disposalFailure = error
    } finally {
      context.registry.forget(taskId)
      recordResidency(context, taskId, cause)
    }
    if (disposalFailure !== undefined) throw new ResidentTaskDisposalError(taskId, disposalFailure)
    return
  }
  recordResidency(context, taskId, cause)
}

async function teardownHandle(handle: ResidentHandle): Promise<void> {
  // The pre-dispose step (in-process abort / rpc terminate) is best-effort: an already-exited child
  // rejects it. Swallow-and-log so dispose() ALWAYS runs and destroyResidentTask keeps going to
  // forget + record disposed - a re-thrown abort would leave a resident zombie the LRU can never
  // reclaim (the residency-slot leak this teardown exists to prevent).
  if (handle.kind === "in-process") await bestEffort(handle.task_id, "abort", () => handle.abort())
  else await bestEffort(handle.task_id, "terminate", () => handle.terminate())
  await handle.dispose()
}

async function bestEffort(taskId: string, step: "abort" | "terminate", run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    log("senpi-task teardown pre-dispose step rejected", { taskId, step, error: String(error) })
  }
}

function recordResidency(context: LifecycleContext, taskId: string, cause: DestroyCause): void {
  if (context.store.load(taskId) === null) return
  const type = cause === "evict" ? "evict" : "dispose"
  context.store.transition(taskId, { type, timestamp: nowIso(context) })
  const eventType = cause === "evict" ? "evicted" : "destroyed"
  context.store.appendEvent(taskId, { type: eventType, payload: { cause } })
}
