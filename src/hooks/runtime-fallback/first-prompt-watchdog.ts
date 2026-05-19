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

const TERMINAL_EVENT_TYPES = new Set([
  "session.idle",
  "session.stop",
  "session.deleted",
  "session.error",
])

/**
 * Translate an OpenCode session event into the appropriate watchdog signal.
 *
 * Progress semantics for cancelling the watchdog:
 *   - assistant `info.error` set: the existing message-update-handler will
 *     deal with the error path; the watchdog has done its job.
 *   - assistant `info.finish` set: the response completed.
 *   - any assistant part with a known type (`text`, `reasoning`, `tool`,
 *     `tool_use`, `tool_result`, `tool-call`, `step-start`, `file`, ...):
 *     the model has started responding. A subagent that immediately runs
 *     tools is *working*, not silent — so any part presence cancels.
 */
export function observeEventForWatchdog(
  event: { type: string; properties?: unknown },
  watchdog: FirstPromptWatchdog,
): void {
  const props = event.properties as Record<string, unknown> | undefined
  if (!props) return

  if (event.type === "message.part.updated" || event.type === "message.part.delta") {
    const sessionID = props.sessionID as string | undefined
    const part = props.part as Record<string, unknown> | undefined
    const partType = typeof part?.type === "string"
      ? part.type
      : typeof props.type === "string" ? props.type : undefined
    if (sessionID && partType) {
      watchdog.onAssistantProgress(sessionID)
    }
    return
  }

  if (event.type === "message.updated") {
    const info = props.info as Record<string, unknown> | undefined
    const sessionID = info?.sessionID as string | undefined
    const role = info?.role as string | undefined
    if (!sessionID || !role) return

    if (role === "user") {
      const model = info?.model as string | undefined
      const agent = info?.agent as string | undefined
      watchdog.onUserMessage(sessionID, model, agent)
      return
    }

    if (role === "assistant") {
      const hasError = info?.error !== undefined
      const hasFinish = info?.finish !== undefined
      const eventParts = props.parts as Array<{ type?: string }> | undefined
      const infoParts = info?.parts as Array<{ type?: string }> | undefined
      const parts = eventParts ?? infoParts ?? []
      const hasAnyPart = parts.some((part) => typeof part?.type === "string")
      if (hasError || hasFinish || hasAnyPart) {
        watchdog.onAssistantProgress(sessionID)
      }
    }
    return
  }

  if (TERMINAL_EVENT_TYPES.has(event.type)) {
    const sessionID =
      (props.sessionID as string | undefined) ??
      ((props.info as Record<string, unknown> | undefined)?.id as string | undefined)
    if (sessionID) watchdog.onSessionTerminal(sessionID)
  }
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
