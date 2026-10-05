// How the sidecar lets go of a child and prepares the next one: the reseed state a replacement
// child inherits at the context budget, the jittered backoff after a failure, and disposal.

import { KIBITZER_REJECTED_AFTER_WAKES } from "./sidecar-contract"
import { describe, type SidecarCore } from "./sidecar-core"
import { backoffDelayMs } from "./wake-policy"

export interface SidecarRecovery {
  /**
   * The replacement child inherits only what a restart would otherwise lose: paths declined through
   * three wake opportunities, paths already delivered, the task line and the last cursor. Every
   * other offered path is forgotten so it may wake the new child again.
   */
  prepareReseed(wake: number): void
  /** Exponential backoff with jitter; the timer returns the sidecar to `idle`, nothing is recreated. */
  enterBackoff(): void
  clearBackoff(): void
  /** Unsubscribes and disposes the current child, if any; a dispose failure is logged, never thrown. */
  disposeChild(): void
}

export function createRecovery(core: SidecarCore): SidecarRecovery {
  function prepareReseed(wake: number): void {
    const rejected = [...core.offeredAtWake]
      .filter(([path, at]) => !core.delivered.has(path) && wake - at + 1 >= KIBITZER_REJECTED_AFTER_WAKES)
      .map(([path]) => path)
    core.pendingReseed = {
      sessionId: core.sessionId,
      lastCursor: core.stream.lastCursor() ?? 0,
      taskSummary: core.taskSummary ?? "",
      rejectedPaths: rejected,
      deliveredPaths: [...core.delivered],
    }
    core.offered.clear()
    for (const path of rejected) core.offered.add(path)
    for (const path of core.delivered) core.offered.add(path)
    for (const path of [...core.offeredAtWake.keys()]) if (!core.offered.has(path)) core.offeredAtWake.delete(path)
  }

  function enterBackoff(): void {
    const delay = backoffDelayMs(core.consecutiveFailures, core.random)
    core.consecutiveFailures += 1
    core.state = "backoff"
    clearBackoff()
    core.backoffTimer = core.timers.set(() => {
      core.backoffTimer = undefined
      if (core.state === "backoff") core.state = "idle"
    }, delay)
  }

  function clearBackoff(): void {
    if (core.backoffTimer === undefined) return
    core.timers.clear(core.backoffTimer)
    core.backoffTimer = undefined
  }

  function disposeChild(): void {
    const current = core.child
    if (current === undefined) return
    core.child = undefined
    current.unsubscribe()
    try {
      current.handle.dispose()
    } catch (error) {
      core.warn("omo-senpi kibitzer sidecar dispose failed", { generation: current.generation, error: describe(error) })
    }
  }

  return { prepareReseed, enterBackoff, clearBackoff, disposeChild }
}
