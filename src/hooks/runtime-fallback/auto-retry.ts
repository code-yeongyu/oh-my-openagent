import type { HookDeps } from "./types"
import { createAbortSessionRequest } from "./auto-retry-abort"
import { createAgentContextResolver } from "./auto-retry-agent-context"
import { createAutoRetryDispatcher } from "./auto-retry-dispatch"
import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import { createStaleSessionCleanup } from "./auto-retry-cleanup"

export function createAutoRetryHelpers(deps: HookDeps) {
  const abortSessionRequest = createAbortSessionRequest(deps)
  let autoRetryWithFallback: ReturnType<typeof createAutoRetryDispatcher>

  const { clearSessionFallbackTimeout, scheduleSessionFallbackTimeout } = createFallbackTimeoutHelpers(
    deps,
    abortSessionRequest,
    (sessionID, newModel, resolvedAgent, source) =>
      autoRetryWithFallback(sessionID, newModel, resolvedAgent, source),
  )

  autoRetryWithFallback = createAutoRetryDispatcher(
    deps,
    scheduleSessionFallbackTimeout,
    clearSessionFallbackTimeout,
  )

  return {
    abortSessionRequest,
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
    autoRetryWithFallback,
    resolveAgentForSessionFromContext: createAgentContextResolver(deps),
    cleanupStaleSessions: createStaleSessionCleanup(deps, clearSessionFallbackTimeout),
  }
}

export type AutoRetryHelpers = ReturnType<typeof createAutoRetryHelpers>
