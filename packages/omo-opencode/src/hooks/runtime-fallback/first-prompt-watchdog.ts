import type { HookDeps, RuntimeFallbackTimeout } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, DEFAULT_FIRST_PROMPT_WATCHDOG_MS } from "./constants"
import { log } from "../../shared/logger"
import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import { createWatchdogAbortProvenance } from "./watchdog-abort-provenance"
import type { ArmedWatchdog, WatchdogEventDecision } from "./first-prompt-watchdog-types"
import { fireFirstPromptWatchdog } from "./first-prompt-watchdog-fire"

const SOURCE = "first-prompt-watchdog"

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export interface FirstPromptWatchdog {
  onUserMessage(sessionID: string, model?: string, agent?: string, messageID?: string): void
  onAssistantProgress(sessionID: string, parentMessageID?: string, isAbortEvent?: boolean): WatchdogEventDecision | undefined
  onSessionTerminal(sessionID: string, eventType?: string, isAbortEvent?: boolean): WatchdogEventDecision | undefined
  resolveDeferredTerminal(sessionID: string, currentRequestActive: boolean): WatchdogEventDecision | undefined
  dispose(): void
}

export { observeEventForWatchdog } from "./first-prompt-watchdog-events"
export type { WatchdogEventDecision } from "./first-prompt-watchdog-types"

export function createFirstPromptWatchdog(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  watchdogMs: number = DEFAULT_FIRST_PROMPT_WATCHDOG_MS,
): FirstPromptWatchdog {
  const timers = new Map<string, RuntimeFallbackTimeout>()
  const armed = new Map<string, ArmedWatchdog>()
  const suspended = new Map<string, ArmedWatchdog>()
  const progressed = new Map<string, ArmedWatchdog>()
  const suspendedAfterProgress = new Set<string>()
  const sessionGenerations = new Map<string, number>()
  const currentUserMessageIDs = new Map<string, string>()
  const abortProvenance = createWatchdogAbortProvenance()
  let lifecycleGeneration = 0

  const cancel = (sessionID: string, preserveAbortProvenance = false): void => {
    const timer = timers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionID)
    }
    armed.delete(sessionID)
    suspended.delete(sessionID)
    progressed.delete(sessionID)
    suspendedAfterProgress.delete(sessionID)
    if (!preserveAbortProvenance) abortProvenance.clear(sessionID)
    currentUserMessageIDs.delete(sessionID)
    sessionGenerations.set(sessionID, (sessionGenerations.get(sessionID) ?? 0) + 1)
  }

  const arm = (context: ArmedWatchdog): void => {
    armed.set(context.sessionID, context)
    const remainingMs = Math.max(0, context.deadlineAt - Date.now())
    const timer = setTimeout(async () => {
      try {
        timers.delete(context.sessionID)
        await fireFirstPromptWatchdog({
          deps,
          helpers,
          watchdogMs,
          sessionID: context.sessionID,
          model: context.model,
          agent: context.agent,
          wasSubagent: context.wasSubagent,
          isLifecycleCurrent: () => context.generation === lifecycleGeneration,
          isSessionCurrent: () => context.sessionGeneration === sessionGenerations.get(context.sessionID),
          recordAbortProvenance: () => abortProvenance.record(context.sessionID, context.sessionGeneration),
        })
      } finally {
        if (
          context.sessionGeneration === sessionGenerations.get(context.sessionID)
          && armed.get(context.sessionID) === context
        ) {
          armed.delete(context.sessionID)
        }
      }
    }, remainingMs)
    timers.set(context.sessionID, timer)
  }

  const suspend = (sessionID: string): boolean => {
    const context = armed.get(sessionID)
    if (!context) return false
    const timer = timers.get(sessionID)
    if (timer) clearTimeout(timer)
    timers.delete(sessionID)
    armed.delete(sessionID)
    suspended.set(sessionID, context)
    return true
  }

  const suspendAfterProgress = (sessionID: string): boolean => {
    const context = progressed.get(sessionID)
    if (!context) return false
    progressed.delete(sessionID)
    suspended.set(sessionID, context)
    suspendedAfterProgress.add(sessionID)
    return true
  }

  return {
    onUserMessage(sessionID, model, agent, messageID) {
      if (!sessionID || deps.sessionAwaitingFallbackResult.has(sessionID)) return
      if (armed.has(sessionID)) return
      progressed.delete(sessionID)

      const wasSubagent = subagentSessions.has(sessionID)
      const mainSessionID = getMainSessionID()
      if (!wasSubagent && mainSessionID !== undefined && mainSessionID !== sessionID) return
      if (!wasSubagent && deps.config.timeout_seconds <= 0) return

      const generation = lifecycleGeneration
      const sessionGeneration = (sessionGenerations.get(sessionID) ?? 0) + 1
      sessionGenerations.set(sessionID, sessionGeneration)
      if (messageID) currentUserMessageIDs.set(sessionID, messageID)
      else currentUserMessageIDs.delete(sessionID)
      arm({
        sessionID,
        model,
        agent,
        wasSubagent,
        generation,
        sessionGeneration,
        deadlineAt: Date.now() + watchdogMs,
      })

      log(`[${HOOK_NAME}] ${SOURCE}: armed`, { sessionID, model, agent, watchdogMs })
    },
    onAssistantProgress(sessionID, parentMessageID, isAbortEvent) {
      if (!sessionID) return
      if (
        isAbortEvent !== true
        && parentMessageID !== undefined
        && parentMessageID === currentUserMessageIDs.get(sessionID)
      ) return
      const suspendedContext = suspended.get(sessionID)
      if (suspendedContext && isAbortEvent === true) {
        const currentUserMessageID = currentUserMessageIDs.get(sessionID)
        const isPriorGeneration = parentMessageID !== undefined
          && currentUserMessageID !== undefined
          && parentMessageID !== currentUserMessageID
          && abortProvenance.consumePrior(sessionID, suspendedContext.sessionGeneration)
        if (isPriorGeneration) {
          return { kind: "inspect-terminal", sessionID }
        }
        suspended.delete(sessionID)
        deps.internallyAbortedSessions.delete(sessionID)
        cancel(sessionID, true)
        log(`[${HOOK_NAME}] ${SOURCE}: resolved external cancellation`, { sessionID })
        return { kind: "resolve-terminal", sessionID }
      }
      if (suspendedContext) {
        abortProvenance.consumePrior(sessionID, suspendedContext.sessionGeneration)
        deps.internallyAbortedSessions.add(sessionID)
        cancel(sessionID, true)
        return { kind: "resolve-terminal", sessionID }
      }
      if (!armed.has(sessionID)) return
      if (deps.internallyAbortedSessions.has(sessionID)) return
      const context = armed.get(sessionID)
      const timer = timers.get(sessionID)
      if (timer) clearTimeout(timer)
      timers.delete(sessionID)
      armed.delete(sessionID)
      if (context) progressed.set(sessionID, context)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (assistant progress observed)`, { sessionID })
    },
    onSessionTerminal(sessionID, eventType, isAbortEvent) {
      if (!sessionID) return
      const suspendedContext = suspended.get(sessionID)
      if (suspendedContext) {
        if (eventType === "session.idle") return
        if (eventType === "session.error" && isAbortEvent === false) {
          abortProvenance.consumePrior(sessionID, suspendedContext.sessionGeneration)
          deps.internallyAbortedSessions.add(sessionID)
          cancel(sessionID, true)
          return { kind: "resolve-terminal", sessionID }
        }
        deps.internallyAbortedSessions.delete(sessionID)
        cancel(sessionID)
        return { kind: "resolve-terminal", sessionID }
      }
      if (
        eventType === "session.error"
        && isAbortEvent === true
      ) {
        const currentGeneration = sessionGenerations.get(sessionID)
        if (
          abortProvenance.hasPrior(sessionID, currentGeneration)
          && (suspend(sessionID) || suspendAfterProgress(sessionID))
        ) {
          log(`[${HOOK_NAME}] ${SOURCE}: deferred ambiguous abort for message correlation`, { sessionID })
          return { kind: "defer-terminal", sessionID }
        }
        deps.internallyAbortedSessions.delete(sessionID)
        abortProvenance.clear(sessionID)
      }
      if (!armed.has(sessionID)) {
        if (eventType === "session.deleted" || eventType === "session.stop") {
          cancel(sessionID)
          sessionGenerations.delete(sessionID)
        } else if (
          eventType === "session.idle"
          && !abortProvenance.hasPrior(sessionID, sessionGenerations.get(sessionID))
        ) {
          progressed.delete(sessionID)
          currentUserMessageIDs.delete(sessionID)
        }
        return
      }
      if (
        eventType === "session.idle"
        && deps.internallyAbortedSessions.has(sessionID)
      ) return
      cancel(sessionID)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (session terminal)`, { sessionID })
    },
    resolveDeferredTerminal(sessionID, currentRequestActive) {
      const suspendedContext = suspended.get(sessionID)
      if (!suspendedContext) return
      suspended.delete(sessionID)
      const shouldResumeWatchdog = !suspendedAfterProgress.delete(sessionID)
      if (currentRequestActive) {
        deps.internallyAbortedSessions.add(sessionID)
        if (shouldResumeWatchdog && !armed.has(sessionID)) arm(suspendedContext)
        log(`[${HOOK_NAME}] ${SOURCE}: resolved delayed prior-generation abort`, { sessionID })
      } else {
        deps.internallyAbortedSessions.delete(sessionID)
        cancel(sessionID, true)
        log(`[${HOOK_NAME}] ${SOURCE}: resolved external cancellation`, { sessionID })
      }
      return { kind: "resolve-terminal", sessionID }
    },
    dispose() {
      lifecycleGeneration += 1
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      armed.clear()
      suspended.clear()
      progressed.clear()
      suspendedAfterProgress.clear()
      sessionGenerations.clear()
      currentUserMessageIDs.clear()
      abortProvenance.clearAll()
    },
  }
}
