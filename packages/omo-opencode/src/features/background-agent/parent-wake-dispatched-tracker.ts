import { cloneParentWake, type PendingParentWake } from "./parent-wake-dedupe"
import { unrefTimerHandle } from "./parent-wake-timer-handle"

type ParentWakeDispatchedTrackerOptions = {
  readonly failureRequeueWindowMs: number
  readonly onFailureRequeueWindowElapsed: (sessionID: string, wake: PendingParentWake) => void
}

export class ParentWakeDispatchedTracker {
  private dispatchedParentWakes: Map<string, PendingParentWake> = new Map()
  private dispatchedParentWakeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  constructor(private readonly options: ParentWakeDispatchedTrackerOptions) {}

  getWakes(): Map<string, PendingParentWake> {
    return this.dispatchedParentWakes
  }

  getTimers(): Map<string, ReturnType<typeof setTimeout>> {
    return this.dispatchedParentWakeTimers
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
    this.clearWake(sessionID)
    const dispatchedWake = cloneParentWake(wake)
    dispatchedWake.dispatchedAt = dispatchedAt
    this.dispatchedParentWakes.set(sessionID, dispatchedWake)
    this.scheduleFailureWindowTimer(sessionID)
  }

  refreshWakeTimer(sessionID: string): void {
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
    for (const timer of this.dispatchedParentWakeTimers.values()) {
      clearTimeout(timer)
    }
    this.dispatchedParentWakeTimers.clear()
    this.dispatchedParentWakes.clear()
  }
}
