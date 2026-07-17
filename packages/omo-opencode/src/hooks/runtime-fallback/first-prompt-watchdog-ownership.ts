import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { acquireInternalAbortOwnership, clearInternalAbortOwnership } from "./internal-abort-ownership"
import type { ArmedWatchdog, WatchdogEventDecision } from "./first-prompt-watchdog-types"
import type { HookDeps, RuntimeFallbackTimeout } from "./types"

const SOURCE = "first-prompt-watchdog"

declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export type FallbackOwnershipTransfer = {
  commit(): void
  rollback(): void
}

type OwnershipState = {
  deps: HookDeps
  watchdogMs: number
  timers: Map<string, RuntimeFallbackTimeout>
  armed: Map<string, ArmedWatchdog>
  suspended: Map<string, ArmedWatchdog>
  progressed: Map<string, ArmedWatchdog>
  suspendedAfterProgress: Set<string>
  currentUserMessageIDs: Map<string, string>
  sessionGenerations: Map<string, number>
  getLifecycleGeneration(): number
  cancel(sessionID: string, preserveAbortProvenance?: boolean): void
  arm(context: ArmedWatchdog): void
}

export function createWatchdogOwnershipHandlers(state: OwnershipState) {
  const transferFallbackOwnership = (sessionID: string): FallbackOwnershipTransfer | undefined => {
    const context = state.armed.get(sessionID) ?? state.suspended.get(sessionID) ?? state.progressed.get(sessionID)
    if (!context) return
    const kind = state.armed.has(sessionID) ? "armed" : state.suspended.has(sessionID) ? "suspended" : "progressed"
    const remainingMs = Math.max(0, context.deadlineAt - Date.now())
    const wasSuspendedAfterProgress = state.suspendedAfterProgress.delete(sessionID)
    const timer = state.timers.get(sessionID)
    if (timer) clearTimeout(timer)
    state.timers.delete(sessionID)
    state.armed.delete(sessionID)
    state.suspended.delete(sessionID)
    state.progressed.delete(sessionID)
    const isCurrent = () => context.generation === state.getLifecycleGeneration()
      && context.sessionGeneration === state.sessionGenerations.get(sessionID)
    log(`[${HOOK_NAME}] ${SOURCE}: detached fallback ownership`, { sessionID, kind })
    return {
      commit() {
        if (isCurrent()) state.cancel(sessionID)
      },
      rollback() {
        if (!isCurrent()) return
        if (kind === "armed") state.arm({ ...context, deadlineAt: Date.now() + remainingMs })
        if (kind === "progressed") state.progressed.set(sessionID, context)
        if (kind === "suspended") {
          state.suspended.set(sessionID, context)
          if (wasSuspendedAfterProgress) state.suspendedAfterProgress.add(sessionID)
        }
        log(`[${HOOK_NAME}] ${SOURCE}: restored rejected fallback transfer`, { sessionID, kind })
      },
    }
  }

  const resolveDeferredTerminal = (
    sessionID: string,
    currentRequestActive: boolean | undefined,
  ): WatchdogEventDecision | undefined => {
    const suspendedContext = state.suspended.get(sessionID)
    if (!suspendedContext) return
    if (currentRequestActive === undefined) {
      log(`[${HOOK_NAME}] ${SOURCE}: status probe inconclusive; retaining deferred terminal`, { sessionID })
      return
    }
    state.suspended.delete(sessionID)
    const shouldResumeWatchdog = !state.suspendedAfterProgress.delete(sessionID)
    if (currentRequestActive) {
      acquireInternalAbortOwnership(state.deps, sessionID)
      if (shouldResumeWatchdog && !state.armed.has(sessionID)) state.arm(suspendedContext)
      log(`[${HOOK_NAME}] ${SOURCE}: resolved delayed prior-generation abort`, { sessionID })
    } else {
      clearInternalAbortOwnership(state.deps, sessionID)
      state.cancel(sessionID, true)
      log(`[${HOOK_NAME}] ${SOURCE}: resolved external cancellation`, { sessionID })
    }
    return { kind: "resolve-terminal", sessionID }
  }

  return { transferFallbackOwnership, resolveDeferredTerminal }
}
