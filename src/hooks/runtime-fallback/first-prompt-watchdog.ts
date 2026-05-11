import type { HookDeps, RuntimeFallbackTimeout } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, DEFAULT_FIRST_PROMPT_WATCHDOG_MS } from "./constants"
import { log } from "../../shared/logger"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"

const SOURCE = "first-prompt-watchdog"

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export interface FirstPromptWatchdog {
  onUserMessage(sessionID: string, model?: string, agent?: string): void
  onAssistantProgress(sessionID: string): void
  onSessionTerminal(sessionID: string): void
  dispose(): void
}

export function createFirstPromptWatchdog(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  watchdogMs: number = DEFAULT_FIRST_PROMPT_WATCHDOG_MS,
): FirstPromptWatchdog {
  const timers = new Map<string, RuntimeFallbackTimeout>()
  const armed = new Set<string>()

  const cancel = (sessionID: string): void => {
    const timer = timers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionID)
    }
    armed.delete(sessionID)
  }

  const fire = async (sessionID: string, model: string | undefined, agent: string | undefined): Promise<void> => {
    timers.delete(sessionID)
    armed.delete(sessionID)

    if (!subagentSessions.has(sessionID)) {
      log(`[${HOOK_NAME}] ${SOURCE}: session no longer a subagent at fire time, skipping`, { sessionID })
      return
    }

    const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
    const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.pluginConfig)

    if (fallbackModels.length === 0) {
      log(`[${HOOK_NAME}] ${SOURCE}: subagent silent past ${watchdogMs}ms with no fallback configured`, {
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

    log(`[${HOOK_NAME}] ${SOURCE}: subagent silent past ${watchdogMs}ms, dispatching fallback`, {
      sessionID,
      model: state.currentModel,
      fallbackCount: fallbackModels.length,
    })

    // Unlike the error-event path, the original request is still pending from
    // OpenCode's perspective when the watchdog fires. Forcefully end it so the
    // fallback prompt can take over cleanly. Network errors from abort are
    // logged inside abortSessionRequest and do not block fallback dispatch.
    await helpers.abortSessionRequest(sessionID, SOURCE)

    await dispatchFallbackRetry(deps, helpers, {
      sessionID,
      state,
      fallbackModels,
      resolvedAgent,
      source: SOURCE,
    })
  }

  return {
    onUserMessage(sessionID, model, agent) {
      if (!sessionID) return
      if (!subagentSessions.has(sessionID)) return
      if (armed.has(sessionID)) return

      armed.add(sessionID)
      const timer = setTimeout(async () => {
        await fire(sessionID, model, agent)
      }, watchdogMs)
      timers.set(sessionID, timer)

      log(`[${HOOK_NAME}] ${SOURCE}: armed for subagent`, { sessionID, model, agent, watchdogMs })
    },
    onAssistantProgress(sessionID) {
      if (!sessionID || !armed.has(sessionID)) return
      cancel(sessionID)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (assistant progress observed)`, { sessionID })
    },
    onSessionTerminal(sessionID) {
      if (!sessionID || !armed.has(sessionID)) return
      cancel(sessionID)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (session terminal)`, { sessionID })
    },
    dispose() {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      armed.clear()
    },
  }
}
