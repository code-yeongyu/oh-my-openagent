import { cloneParentWake, type PendingParentWake } from "./parent-wake-dedupe"
import { unrefTimerHandle } from "./parent-wake-timer-handle"

type ParentWakeDispatchedTrackerOptions = {
  readonly failureRequeueWindowMs: number
  readonly onFailureRequeueWindowElapsed: (sessionID: string, wake: PendingParentWake) => void
}

export class ParentWakeDispatchedTracker {
  private dispatchedParentWakes: Map<string, PendingParentWake> = new Map()
  private dispatchedParentWakeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  // Sessions whose wake has left the pending queue but is still mid-dispatch
  // (the `await dispatchInternalPrompt(...)` window, which can span the prompt
  // gate's status/message checks plus the dispatch itself). The pending entry is
  // already deleted and the dispatched entry is not yet tracked, so without this
  // marker `hasPendingParentWake` would briefly report "no wake owed" and let the
  // sync poller settle on a stale pre-results turn.
  private inFlightDispatches: Set<string> = new Set()
  // Parent sessions whose final child has been marked terminal but whose wake has
  // not yet been queued, because the completion path is still awaiting the child's
  // session teardown (abort with a 10s timeout, plus the tmux callback). During
  // that window the child no longer counts as active and the wake is not yet in any
  // of the maps above, so without this reservation `hasPendingParentWake` would
  // report "no wake owed" and let a parent sync poller settle on a stale turn. A
  // counter (not a set) so concurrent child teardowns for the same parent each hold
  // their own slot and the predicate only clears once every one has queued its wake.
  private notificationPreparations: Map<string, number> = new Map()
  private shutdownTriggered = false

  constructor(private readonly options: ParentWakeDispatchedTrackerOptions) {}

  getWakes(): Map<string, PendingParentWake> {
    return this.dispatchedParentWakes
  }

  getTimers(): Map<string, ReturnType<typeof setTimeout>> {
    return this.dispatchedParentWakeTimers
  }

  markInFlight(sessionID: string): void {
    if (this.shutdownTriggered) return
    this.inFlightDispatches.add(sessionID)
  }

  clearInFlight(sessionID: string): void {
    this.inFlightDispatches.delete(sessionID)
  }

  hasInFlight(sessionID: string): boolean {
    return this.inFlightDispatches.has(sessionID)
  }

  reserveNotificationPreparation(sessionID: string): void {
    if (this.shutdownTriggered) return
    this.notificationPreparations.set(sessionID, (this.notificationPreparations.get(sessionID) ?? 0) + 1)
  }

  releaseNotificationPreparation(sessionID: string): void {
    const count = this.notificationPreparations.get(sessionID)
    if (count === undefined) {
      return
    }
    if (count <= 1) {
      this.notificationPreparations.delete(sessionID)
    } else {
      this.notificationPreparations.set(sessionID, count - 1)
    }
  }

  hasNotificationPreparation(sessionID: string): boolean {
    return (this.notificationPreparations.get(sessionID) ?? 0) > 0
  }

  getWake(sessionID: string): PendingParentWake | undefined {
    return this.dispatchedParentWakes.get(sessionID)
  }

  hasWake(sessionID: string): boolean {
    return this.dispatchedParentWakes.has(sessionID)
  }

  clearWake(sessionID: string): void {
    const timer = this.dispatchedParentWakeTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      this.dispatchedParentWakeTimers.delete(sessionID)
    }
    this.dispatchedParentWakes.delete(sessionID)
  }

  trackWake(sessionID: string, wake: PendingParentWake, dispatchedAt: number): void {
    if (this.shutdownTriggered) return
    this.clearWake(sessionID)
    const dispatchedWake = cloneParentWake(wake)
    dispatchedWake.dispatchedAt = dispatchedAt
    this.dispatchedParentWakes.set(sessionID, dispatchedWake)
    this.scheduleFailureWindowTimer(sessionID)
  }

  refreshWakeTimer(sessionID: string): void {
    if (this.shutdownTriggered) return
    if (!this.dispatchedParentWakes.has(sessionID)) {
      return
    }
    this.scheduleFailureWindowTimer(sessionID)
  }

  private scheduleFailureWindowTimer(sessionID: string): void {
    const existingTimer = this.dispatchedParentWakeTimers.get(sessionID)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }
    const timer = setTimeout(() => {
      this.dispatchedParentWakeTimers.delete(sessionID)
      const wake = this.dispatchedParentWakes.get(sessionID)
      if (!wake) {
        return
      }
      this.options.onFailureRequeueWindowElapsed(sessionID, cloneParentWake(wake))
    }, this.options.failureRequeueWindowMs)
    unrefTimerHandle(timer)
    this.dispatchedParentWakeTimers.set(sessionID, timer)
  }

  shutdown(): void {
    this.shutdownTriggered = true
    for (const timer of this.dispatchedParentWakeTimers.values()) {
      clearTimeout(timer)
    }
    this.dispatchedParentWakeTimers.clear()
    this.dispatchedParentWakes.clear()
    this.inFlightDispatches.clear()
    this.notificationPreparations.clear()
  }
}
