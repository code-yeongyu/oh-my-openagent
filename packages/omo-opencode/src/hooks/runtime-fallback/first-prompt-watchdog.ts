import type { HookDeps, RuntimeFallbackTimeout } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME, DEFAULT_FIRST_PROMPT_WATCHDOG_MS } from "./constants"
import { log } from "../../shared/logger"
import { subagentSessions } from "../../features/claude-code-session-state"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { isRecord } from "../../shared/record-type-guard"
import { normalizeModelToCanonicalString } from "./normalize-model"
import { createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import {
  invalidateFallbackDispatchLease,
  isFallbackDispatchLeaseOwner,
  releaseFallbackDispatchLease,
  tryAcquireFallbackDispatchLease,
  type FallbackDispatchLease,
} from "./fallback-dispatch-lease"

const SOURCE = "first-prompt-watchdog"
const SESSION_NEXT_EVENT_PREFIX = "session.next."

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export interface FirstPromptWatchdog {
  onUserMessage(sessionID: string, model?: string, agent?: string): void
  onAssistantProgress(sessionID: string): void
  onSessionTerminal(sessionID: string, eventType?: string): void
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

    if (role === "user") {
      const model = normalizeModelToCanonicalString(info?.model)
      const agent = typeof info?.agent === "string" ? info.agent : undefined
      watchdog.onUserMessage(sessionID, model, agent)
      return
    }

    if (role === "assistant") {
      const hasError = info?.error !== undefined
      const hasFinish = hasAssistantCompletionMarker(info)
      const eventParts = Array.isArray(props.parts) ? props.parts : undefined
      const infoParts = Array.isArray(info?.parts) ? info.parts : undefined
      const parts = eventParts ?? infoParts ?? []
      const hasAnyPart = parts.some((part) => isRecord(part) && typeof part.type === "string")
      if (hasError || hasFinish || hasAnyPart) {
        watchdog.onAssistantProgress(sessionID)
      }
    }
    return
  }

  if (TERMINAL_EVENT_TYPES.has(event.type)) {
    const sessionID = resolveSessionEventID(props)
    if (sessionID) watchdog.onSessionTerminal(sessionID, event.type)
  }
}

type WatchdogFirePhase = "resolving" | "aborting" | "dispatching"

type ActiveWatchdogFire = {
  generation: number
  phase: WatchdogFirePhase
}

export function createFirstPromptWatchdog(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  watchdogMs: number = DEFAULT_FIRST_PROMPT_WATCHDOG_MS,
): FirstPromptWatchdog {
  const timers = new Map<string, RuntimeFallbackTimeout>()
  const armed = new Set<string>()
  const generations = new Map<string, number>()
  const activeFires = new Map<string, ActiveWatchdogFire>()
  const pendingInternalAbortIdle = new Map<string, number>()
  let disposed = false

  const clearTimer = (sessionID: string): void => {
    const timer = timers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionID)
    }
    armed.delete(sessionID)
  }

  const advanceGeneration = (sessionID: string): number => {
    const nextGeneration = (generations.get(sessionID) ?? 0) + 1
    generations.set(sessionID, nextGeneration)
    return nextGeneration
  }

  const hasTrackedWork = (sessionID: string): boolean => armed.has(sessionID) || activeFires.has(sessionID)

  const finishGeneration = (sessionID: string, generation: number): void => {
    const active = activeFires.get(sessionID)
    if (active?.generation === generation) {
      activeFires.delete(sessionID)
    }
    if (pendingInternalAbortIdle.get(sessionID) === generation) {
      pendingInternalAbortIdle.delete(sessionID)
    }
    if (!armed.has(sessionID) && !activeFires.has(sessionID)) {
      generations.delete(sessionID)
    }
  }

  const cancelTrackedWork = (sessionID: string): void => {
    if (!hasTrackedWork(sessionID)) return
    clearTimer(sessionID)
    pendingInternalAbortIdle.delete(sessionID)
    advanceGeneration(sessionID)
    invalidateFallbackDispatchLease(deps, sessionID)
  }

  const fire = async (
    sessionID: string,
    model: string | undefined,
    agent: string | undefined,
    generation: number,
  ): Promise<void> => {
    timers.delete(sessionID)
    armed.delete(sessionID)

    if (disposed || generations.get(sessionID) !== generation) return

    if (!subagentSessions.has(sessionID)) {
      log(`[${HOOK_NAME}] ${SOURCE}: session no longer a subagent at fire time, skipping`, { sessionID })
      finishGeneration(sessionID, generation)
      return
    }

    const lease = tryAcquireFallbackDispatchLease(deps, sessionID, { rejectAwaitingFallback: true })
    if (!lease) {
      log(`[${HOOK_NAME}] ${SOURCE}: fallback already owns session at fire time, skipping`, { sessionID })
      finishGeneration(sessionID, generation)
      return
    }

    const activeFire: ActiveWatchdogFire = { generation, phase: "resolving" }
    activeFires.set(sessionID, activeFire)

    const canContinue = (activeLease: FallbackDispatchLease): boolean => (
      !disposed
      && generations.get(sessionID) === generation
      && activeFires.get(sessionID)?.generation === generation
      && isFallbackDispatchLeaseOwner(deps, sessionID, activeLease)
      && !deps.sessionRetryInFlight.has(sessionID)
      && !deps.sessionAwaitingFallbackResult.has(sessionID)
    )

    try {
      const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
      if (!canContinue(lease)) {
        log(`[${HOOK_NAME}] ${SOURCE}: fallback ownership changed before abort, skipping`, { sessionID })
        return
      }
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
      activeFire.phase = "aborting"
      await helpers.abortSessionRequest(sessionID, SOURCE)
      if (!canContinue(lease)) {
        log(`[${HOOK_NAME}] ${SOURCE}: fallback ownership changed during abort, skipping`, { sessionID })
        return
      }

      activeFire.phase = "dispatching"
      await dispatchFallbackRetry(deps, helpers, {
        sessionID,
        state,
        fallbackModels,
        resolvedAgent,
        source: SOURCE,
        lease,
      })
    } finally {
      releaseFallbackDispatchLease(deps, sessionID, lease)
      finishGeneration(sessionID, generation)
    }
  }

  return {
    onUserMessage(sessionID, model, agent) {
      if (disposed || !sessionID || watchdogMs <= 0) return
      if (!subagentSessions.has(sessionID)) return
      if (deps.sessionAwaitingFallbackResult.has(sessionID)) {
        const activeFire = activeFires.get(sessionID)
        if (armed.has(sessionID) || activeFire?.phase === "resolving" || activeFire?.phase === "aborting") {
          cancelTrackedWork(sessionID)
        }
        log(`[${HOOK_NAME}] ${SOURCE}: fallback already owns session, skipping arm`, { sessionID })
        return
      }
      if (armed.has(sessionID)) return

      cancelTrackedWork(sessionID)
      const generation = advanceGeneration(sessionID)

      armed.add(sessionID)
      const timer = setTimeout(async () => {
        await fire(sessionID, model, agent, generation)
      }, watchdogMs)
      timers.set(sessionID, timer)

      log(`[${HOOK_NAME}] ${SOURCE}: armed for subagent`, { sessionID, model, agent, watchdogMs })
    },
    onAssistantProgress(sessionID) {
      const activeFire = activeFires.get(sessionID)
      if (!sessionID || (!armed.has(sessionID) && activeFire?.phase !== "resolving")) return
      cancelTrackedWork(sessionID)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (assistant progress observed)`, { sessionID })
    },
    onSessionTerminal(sessionID, eventType) {
      const activeFire = activeFires.get(sessionID)
      if (!sessionID || (!armed.has(sessionID) && !activeFire)) return
      if (
        activeFire
        && activeFire.phase !== "resolving"
        && eventType === "session.error"
        && deps.internallyAbortedSessions.has(sessionID)
      ) {
        // OpenCode emits session.error and then session.idle for the request
        // that this watchdog just aborted. The error handler consumes the
        // marker after this observer runs, so remember exactly one trailing
        // idle rather than masking later fallback-model errors.
        pendingInternalAbortIdle.set(sessionID, activeFire.generation)
        log(`[${HOOK_NAME}] ${SOURCE}: ignoring internal abort error`, { sessionID, eventType })
        return
      }
      if (
        eventType === "session.idle"
        && activeFire
        && pendingInternalAbortIdle.get(sessionID) === activeFire.generation
      ) {
        pendingInternalAbortIdle.delete(sessionID)
        log(`[${HOOK_NAME}] ${SOURCE}: ignoring trailing idle from its own abort`, { sessionID, eventType })
        return
      }
      cancelTrackedWork(sessionID)
      log(`[${HOOK_NAME}] ${SOURCE}: cancelled (session terminal)`, { sessionID })
    },
    dispose() {
      disposed = true
      const trackedSessions = new Set([...timers.keys(), ...activeFires.keys()])
      for (const sessionID of trackedSessions) {
        clearTimer(sessionID)
        advanceGeneration(sessionID)
        invalidateFallbackDispatchLease(deps, sessionID)
      }
      timers.clear()
      armed.clear()
      activeFires.clear()
      generations.clear()
      pendingInternalAbortIdle.clear()
    },
  }
}
