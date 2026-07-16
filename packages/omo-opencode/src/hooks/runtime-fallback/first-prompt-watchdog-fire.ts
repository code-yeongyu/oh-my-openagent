import { subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME } from "./constants"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { getFallbackModelsForSession } from "./fallback-models"
import { createFallbackState } from "./fallback-state"
import type { HookDeps } from "./types"

const SOURCE = "first-prompt-watchdog"

type FireFirstPromptWatchdogInput = {
  readonly deps: HookDeps
  readonly helpers: AutoRetryHelpers
  readonly watchdogMs: number
  readonly sessionID: string
  readonly model: string | undefined
  readonly agent: string | undefined
  readonly wasSubagent: boolean
  readonly isLifecycleCurrent: () => boolean
  readonly isSessionCurrent: () => boolean
  readonly recordAbortProvenance: () => void
}

export async function fireFirstPromptWatchdog(input: FireFirstPromptWatchdogInput): Promise<void> {
  const {
    deps,
    helpers,
    watchdogMs,
    sessionID,
    model,
    agent,
    wasSubagent,
    isLifecycleCurrent,
    isSessionCurrent,
    recordAbortProvenance,
  } = input

  if (wasSubagent && !subagentSessions.has(sessionID)) {
    log(`[${HOOK_NAME}] ${SOURCE}: session no longer a subagent at fire time, skipping`, { sessionID })
    return
  }

  const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
  if (!isLifecycleCurrent() || !isSessionCurrent()) return
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

  const abortSucceeded = await helpers.abortSessionRequest(sessionID, SOURCE)
  if (!isLifecycleCurrent() || !isSessionCurrent()) return
  if (abortSucceeded === false) {
    log(`[${HOOK_NAME}] ${SOURCE}: abort failed, skipping fallback dispatch`, { sessionID })
    return
  }
  recordAbortProvenance()
  await Promise.resolve()
  if (!isLifecycleCurrent() || !isSessionCurrent()) return

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

  if (isLifecycleCurrent() && !isSessionCurrent()) {
    await helpers.abortSessionRequest(sessionID, "session.stop")
  }
}
