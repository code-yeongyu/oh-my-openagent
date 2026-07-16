import type { HookDeps, RuntimeFallbackTimeout } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, DEFAULT_FIRST_PROMPT_WATCHDOG_MS } from "./constants"
import { log } from "../../shared/logger"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { createWatchdogAbortProvenance } from "./watchdog-abort-provenance"
import type { ArmedWatchdog, WatchdogEventDecision } from "./first-prompt-watchdog-types"

const SOURCE = "first-prompt-watchdog"

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export interface FirstPromptWatchdog {
  onUserMessage(sessionID: string, model?: string, agent?: string, messageID?: string): void
  onAssistantProgress(sessionID: string, parentMessageID?: string, isAbortEvent?: boolean): WatchdogEventDecision | undefined
  onSessionTerminal(sessionID: string, eventType?: string, isAbortEvent?: boolean): WatchdogEventDecision | undefined
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
  const sessionGenerations = new Map<string, number>()
  const currentUserMessageIDs = new Map<string, string>()
  const abortProvenance = createWatchdogAbortProvenance()
  let lifecycleGeneration = 0

  const cancel = (sessionID: string): void => {
    const timer = timers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionID)
    }
    armed.delete(sessionID)
    suspended.delete(sessionID)
    abortProvenance.clear(sessionID)
    currentUserMessageIDs.delete(sessionID)
    sessionGenerations.set(sessionID, (sessionGenerations.get(sessionID) ?? 0) + 1)
  }

  const fire = async (
    sessionID: string,
    model: string | undefined,
    agent: string | undefined,
    wasSubagent: boolean,
    generation: number,
    sessionGeneration: number,
  ): Promise<void> => {
    timers.delete(sessionID)

    if (wasSubagent && !subagentSessions.has(sessionID)) {
      log(`[${HOOK_NAME}] ${SOURCE}: session no longer a subagent at fire time, skipping`, { sessionID })
      return
    }

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
    if (generation !== lifecycleGeneration || sessionGeneration !== sessionGenerations.get(sessionID)) return
    const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.pluginConfig)

    if (fallbackModels.length === 0) {
      log(`[${HOOK_NAME}] ${SOURCE}: session silent past ${watchdogMs}ms with no fallback configured`, {
        sessionID,
        model,
        agent: resolvedAgent,
      })
      return
    }

    let state = deps.sessionStates.get(sessionID)
    if (!state) {
      const initialModel = resolveFallbackBootstrapModel({
        sessionID,
        source: SOURCE,
        eventModel: model,
        resolvedAgent,
        pluginConfig: deps.pluginConfig,
      })
      if (!initialModel) {
        log(`[${HOOK_NAME}] ${SOURCE}: no model info available, cannot dispatch fallback`, { sessionID })
        return
      }
      state = createFallbackState(initialModel)
      deps.sessionStates.set(sessionID, state)
      deps.sessionLastAccess.set(sessionID, Date.now())
    }

    log(`[${HOOK_NAME}] ${SOURCE}: session silent past ${watchdogMs}ms, dispatching fallback`, {
      sessionID,
      model: state.currentModel,
      fallbackCount: fallbackModels.length,
    })

    // Unlike the error-event path, the original request is still pending from
    // OpenCode's perspective when the watchdog fires. Forcefully end it so the
    // fallback prompt can take over cleanly. If OpenCode rejects the abort,
    // do not start a competing request while the original may still be live.
    const abortSucceeded = await helpers.abortSessionRequest(sessionID, SOURCE)
    if (generation !== lifecycleGeneration || sessionGeneration !== sessionGenerations.get(sessionID)) return
    if (abortSucceeded === false) {
      log(`[${HOOK_NAME}] ${SOURCE}: abort failed, skipping fallback dispatch`, { sessionID })
      return
    }
    abortProvenance.record(sessionID, sessionGeneration)
    await Promise.resolve()
    if (generation !== lifecycleGeneration || sessionGeneration !== sessionGenerations.get(sessionID)) return

    try {
      await dispatchFallbackRetry(deps, helpers, {
        sessionID,
        state,
        fallbackModels,
        resolvedAgent,
        source: SOURCE,
      })
    } finally {
      deps.internallyAbortedSessions.delete(sessionID)
    }

    if (
      generation === lifecycleGeneration
      && sessionGeneration !== sessionGenerations.get(sessionID)
    ) {
      await helpers.abortSessionRequest(sessionID, "session.stop")
    }
  }

  const arm = (context: ArmedWatchdog): void => {
    armed.set(context.sessionID, context)
    const timer = setTimeout(async () => {
      try {
        await fire(
          context.sessionID,
          context.model,
          context.agent,
          context.wasSubagent,
          context.generation,
          context.sessionGeneration,
        )
      } finally {
        if (
          context.sessionGeneration === sessionGenerations.get(context.sessionID)
          && armed.get(context.sessionID) === context
        ) {
          armed.delete(context.sessionID)
        }
      }
    }, watchdogMs)
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

  return {
    onUserMessage(sessionID, model, agent, messageID) {
      if (!sessionID || deps.sessionAwaitingFallbackResult.has(sessionID)) return
      if (armed.has(sessionID) || suspended.has(sessionID)) return

      const wasSubagent = subagentSessions.has(sessionID)
      if (!wasSubagent && deps.config.timeout_seconds <= 0) return

      const generation = lifecycleGeneration
      const sessionGeneration = (sessionGenerations.get(sessionID) ?? 0) + 1
      sessionGenerations.set(sessionID, sessionGeneration)
      if (messageID) currentUserMessageIDs.set(sessionID, messageID)
      else currentUserMessageIDs.delete(sessionID)
      arm({ sessionID, model, agent, wasSubagent, generation, sessionGeneration })

      log(`[${HOOK_NAME}] ${SOURCE}: armed`, { sessionID, model, agent, watchdogMs })
    },
    onAssistantProgress(sessionID, parentMessageID, isAbortEvent) {
      if (!sessionID) return
      const suspendedContext = suspended.get(sessionID)
      if (suspendedContext && isAbortEvent === true) {
        suspended.delete(sessionID)
        const currentUserMessageID = currentUserMessageIDs.get(sessionID)
        const isPriorGeneration = parentMessageID !== undefined
          && currentUserMessageID !== undefined
          && parentMessageID !== currentUserMessageID
          && abortProvenance.consumePrior(sessionID, suspendedContext.sessionGeneration)
        if (isPriorGeneration) {
          deps.internallyAbortedSessions.add(sessionID)
          arm(suspendedContext)
          log(`[${HOOK_NAME}] ${SOURCE}: resolved delayed prior-generation abort`, { sessionID })
        } else {
          deps.internallyAbortedSessions.delete(sessionID)
          cancel(sessionID)
          log(`[${HOOK_NAME}] ${SOURCE}: resolved external cancellation`, { sessionID })
        }
        return { kind: "resolve-terminal", sessionID }
      }
      if (suspendedContext) {
        abortProvenance.consumePrior(sessionID, suspendedContext.sessionGeneration)
        deps.internallyAbortedSessions.add(sessionID)
        cancel(sessionID)
        return { kind: "resolve-terminal", sessionID }
      }
      if (!armed.has(sessionID)) return
      if (deps.internallyAbortedSessions.has(sessionID)) return
      cancel(sessionID)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (assistant progress observed)`, { sessionID })
    },
    onSessionTerminal(sessionID, eventType, isAbortEvent) {
      if (!sessionID) return
      if (suspended.has(sessionID)) {
        deps.internallyAbortedSessions.delete(sessionID)
        cancel(sessionID)
        return { kind: "resolve-terminal", sessionID }
      }
      if (
        eventType === "session.error"
        && isAbortEvent === true
      ) {
        const currentGeneration = sessionGenerations.get(sessionID)
        if (abortProvenance.hasPrior(sessionID, currentGeneration) && suspend(sessionID)) {
          log(`[${HOOK_NAME}] ${SOURCE}: deferred ambiguous abort for message correlation`, { sessionID })
          return { kind: "defer-terminal", sessionID }
        }
        deps.internallyAbortedSessions.delete(sessionID)
        abortProvenance.clear(sessionID)
      }
      if (!armed.has(sessionID)) {
        if (eventType === "session.deleted" || eventType === "session.stop") {
          abortProvenance.clear(sessionID)
          sessionGenerations.delete(sessionID)
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
    dispose() {
      lifecycleGeneration += 1
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      armed.clear()
      suspended.clear()
      sessionGenerations.clear()
      currentUserMessageIDs.clear()
      abortProvenance.clearAll()
    },
  }
}
