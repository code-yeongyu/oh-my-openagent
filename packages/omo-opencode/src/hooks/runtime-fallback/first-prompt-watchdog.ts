import type { HookDeps, RuntimeFallbackTimeout } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, DEFAULT_FIRST_PROMPT_WATCHDOG_MS } from "./constants"
import { log } from "../../shared/logger"
import { subagentSessions } from "../../features/claude-code-session-state"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { isRecord } from "../../shared/record-type-guard"
import { isCompactionMessage } from "../../shared/compaction-marker"
import { isAbortError } from "../../shared/is-abort-error"
import { normalizeModelToCanonicalString } from "./normalize-model"
import { createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"

const SOURCE = "first-prompt-watchdog"
const SESSION_NEXT_EVENT_PREFIX = "session.next."

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export interface FirstPromptWatchdog {
  onUserMessage(sessionID: string, model?: string, agent?: string): void
  onAssistantProgress(sessionID: string): void
  onSessionTerminal(sessionID: string, eventType?: string, isAbortEvent?: boolean): void
  dispose(): void
}

const TERMINAL_EVENT_TYPES = new Set([
  "session.idle",
  "session.stop",
  "session.deleted",
  "session.error",
])

function isCompletionMarker(value: unknown): boolean {
  if (typeof value === "boolean") return value
  return value !== undefined && value !== null
}

function hasAssistantCompletionMarker(info: Record<string, unknown>): boolean {
  const time = isRecord(info.time) ? info.time : undefined
  return isCompletionMarker(info.finish)
    || isCompletionMarker(info.finished)
    || isCompletionMarker(info.completed)
    || isCompletionMarker(time?.completed)
}

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
  const props = isRecord(event.properties) ? event.properties : undefined
  if (!props) return

  if (event.type.startsWith(SESSION_NEXT_EVENT_PREFIX)) {
    const sessionID = resolveSessionEventID(props) ?? resolveMessageEventSessionID(props)
    if (sessionID) watchdog.onAssistantProgress(sessionID)
    return
  }

  if (event.type === "message.part.updated" || event.type === "message.part.delta") {
    const sessionID = resolveMessageEventSessionID(props)
    const part = isRecord(props.part) ? props.part : undefined
    const hasPartType = typeof part?.type === "string"
    const hasTopLevelType = typeof props.type === "string"
    const hasTextDelta = props.field === "text" && typeof props.delta === "string"
    const hasNonEmptySessionPart = typeof part?.sessionID === "string" && Object.keys(part).length > 0
    if (sessionID && (hasPartType || hasTopLevelType || hasTextDelta || hasNonEmptySessionPart)) {
      watchdog.onAssistantProgress(sessionID)
    }
    return
  }

  if (event.type === "message.updated") {
    const info = isRecord(props.info) ? props.info : undefined
    if (!info) return
    const sessionID = typeof info?.sessionID === "string" ? info.sessionID : undefined
    const role = typeof info?.role === "string" ? info.role : undefined
    if (!sessionID || !role) return
    const eventParts = Array.isArray(props.parts) ? props.parts : undefined
    const infoParts = Array.isArray(info?.parts) ? info.parts : undefined

    if (role === "user") {
      const model = normalizeModelToCanonicalString(info?.model)
      const agent = typeof info?.agent === "string" ? info.agent : undefined
      if (isCompactionMessage({ agent, parts: [...(eventParts ?? []), ...(infoParts ?? [])] })) return
      watchdog.onUserMessage(sessionID, model, agent)
      return
    }

    if (role === "assistant") {
      const hasError = info?.error !== undefined
      const hasFinish = hasAssistantCompletionMarker(info)
      const parts = [...(eventParts ?? []), ...(infoParts ?? [])]
      const hasAnyPart = parts.some((part) => isRecord(part) && typeof part.type === "string")
      if (hasError || hasFinish || hasAnyPart) {
        watchdog.onAssistantProgress(sessionID)
      }
    }
    return
  }

  if (TERMINAL_EVENT_TYPES.has(event.type)) {
    const sessionID = resolveSessionEventID(props)
    if (sessionID) {
      const abortEvent = event.type === "session.error" ? isAbortError(props.error) : undefined
      watchdog.onSessionTerminal(sessionID, event.type, abortEvent)
    }
  }
}

export function createFirstPromptWatchdog(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  watchdogMs: number = DEFAULT_FIRST_PROMPT_WATCHDOG_MS,
): FirstPromptWatchdog {
  const timers = new Map<string, RuntimeFallbackTimeout>()
  const armed = new Set<string>()
  const sessionGenerations = new Map<string, number>()
  let lifecycleGeneration = 0

  const cancel = (sessionID: string): void => {
    const timer = timers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionID)
    }
    armed.delete(sessionID)
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
      if (armed.has(sessionID)) return

      const wasSubagent = subagentSessions.has(sessionID)
      if (!wasSubagent && deps.config.timeout_seconds <= 0) return

      const generation = lifecycleGeneration
      const sessionGeneration = (sessionGenerations.get(sessionID) ?? 0) + 1
      sessionGenerations.set(sessionID, sessionGeneration)
      armed.add(sessionID)
      const timer = setTimeout(async () => {
        try {
          await fire(sessionID, model, agent, wasSubagent, generation, sessionGeneration)
        } finally {
          if (sessionGeneration === sessionGenerations.get(sessionID)) {
            armed.delete(sessionID)
            sessionGenerations.delete(sessionID)
          }
        }
      }, watchdogMs)
      timers.set(sessionID, timer)

      log(`[${HOOK_NAME}] ${SOURCE}: armed`, { sessionID, model, agent, watchdogMs })
    },
    onAssistantProgress(sessionID) {
      if (!sessionID || !armed.has(sessionID)) return
      if (deps.internallyAbortedSessions.has(sessionID)) return
      cancel(sessionID)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (assistant progress observed)`, { sessionID })
    },
    onSessionTerminal(sessionID, eventType, isAbortEvent) {
      if (!sessionID || !armed.has(sessionID)) return
      if (
        (eventType === "session.idle" || (eventType === "session.error" && isAbortEvent === true))
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
      sessionGenerations.clear()
    },
  }
}
