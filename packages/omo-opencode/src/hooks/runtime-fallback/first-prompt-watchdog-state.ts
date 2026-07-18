import type { RuntimeFallbackTimeout } from "./types"
import type { ArmedWatchdog } from "./first-prompt-watchdog-types"
import type { WatchdogAbortProvenance } from "./watchdog-abort-provenance"

interface WatchdogCancellationState {
  readonly timers: Map<string, RuntimeFallbackTimeout>
  readonly armed: Map<string, ArmedWatchdog>
  readonly suspended: Map<string, ArmedWatchdog>
  readonly progressed: Map<string, ArmedWatchdog>
  readonly suspendedAfterProgress: Set<string>
  readonly currentAbortInspections: Set<string>
  readonly currentUserMessageIDs: Map<string, string>
  readonly sessionGenerations: Map<string, number>
  readonly abortProvenance: WatchdogAbortProvenance
  readonly clearTimer: (timer: RuntimeFallbackTimeout) => void
  readonly nextSessionGeneration: () => number
}

interface WatchdogDisposableState extends Omit<WatchdogCancellationState, "nextSessionGeneration"> {
  readonly advanceLifecycleGeneration: () => void
}

export function createFirstPromptWatchdogCanceller(state: WatchdogCancellationState) {
  return (sessionID: string, preserveAbortProvenance = false, deleteGeneration = false): void => {
    const timer = state.timers.get(sessionID)
    if (timer) state.clearTimer(timer)
    state.timers.delete(sessionID)
    state.armed.delete(sessionID)
    state.suspended.delete(sessionID)
    state.progressed.delete(sessionID)
    state.suspendedAfterProgress.delete(sessionID)
    state.currentAbortInspections.delete(sessionID)
    if (!preserveAbortProvenance) state.abortProvenance.clear(sessionID)
    state.currentUserMessageIDs.delete(sessionID)
    if (deleteGeneration) state.sessionGenerations.delete(sessionID)
    else state.sessionGenerations.set(sessionID, state.nextSessionGeneration())
  }
}

export function disposeFirstPromptWatchdog(state: WatchdogDisposableState): void {
  state.advanceLifecycleGeneration()
  for (const timer of state.timers.values()) state.clearTimer(timer)
  for (const collection of [
    state.timers,
    state.armed,
    state.suspended,
    state.progressed,
    state.currentAbortInspections,
  ]) collection.clear()
  state.suspendedAfterProgress.clear()
  state.sessionGenerations.clear()
  state.currentUserMessageIDs.clear()
  state.abortProvenance.clearAll()
}
