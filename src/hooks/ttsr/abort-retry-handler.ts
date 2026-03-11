import { renderMultipleInterrupts } from "../../features/ttsr/interrupt-template"
import type { TtsrRule, TtsrSettings } from "../../features/ttsr/types"
import { log } from "../../shared/logger"

export interface AbortRetryHandler {
  handleMatches(sessionID: string, matchedRules: TtsrRule[], settings: TtsrSettings): Promise<void>
  getPendingInjection(sessionID: string): string | undefined
  clearPendingInjection(sessionID: string): void
  clearRetryCounts(sessionID: string): void
}

export interface AbortRetryHandlerDeps {
  abort: (sessionID: string) => Promise<void>
  promptAsync: (sessionID: string, content: string) => Promise<void>
}

export function createAbortRetryHandler(deps: AbortRetryHandlerDeps): AbortRetryHandler {
  const pendingInjections = new Map<string, string>()
  const retryCounts = new Map<string, Map<string, number>>()

  const setPendingInjection = (sessionID: string, content: string): void => {
    pendingInjections.set(sessionID, content)
  }

  const handleMatches = async (
    sessionID: string,
    matchedRules: TtsrRule[],
    settings: TtsrSettings,
  ): Promise<void> => {
    const maxRetries = settings.maxRetriesPerRule ?? 3
    const sessionRetryCounts = retryCounts.get(sessionID) ?? new Map<string, number>()
    retryCounts.set(sessionID, sessionRetryCounts)

    const eligibleRules = matchedRules.filter((rule) => {
      const currentRetryCount = sessionRetryCounts.get(rule.name) ?? 0
      return currentRetryCount < maxRetries
    })

    if (eligibleRules.length === 0) {
      log("[ttsr] abort-retry skipped: max retries reached", {
        sessionID,
        rules: matchedRules.map((rule) => rule.name),
        maxRetries,
      })
      return
    }

    for (const rule of eligibleRules) {
      const currentRetryCount = sessionRetryCounts.get(rule.name) ?? 0
      sessionRetryCounts.set(rule.name, currentRetryCount + 1)
    }

    const interruptContent = renderMultipleInterrupts(eligibleRules)
    setPendingInjection(sessionID, interruptContent)

    log("[ttsr] abort-retry triggered", {
      sessionID,
      rules: eligibleRules.map((rule) => rule.name),
      maxRetries,
    })

    await deps.abort(sessionID)
    await deps.promptAsync(sessionID, interruptContent)
  }

  const getPendingInjection = (sessionID: string): string | undefined => {
    return pendingInjections.get(sessionID)
  }

  const clearPendingInjection = (sessionID: string): void => {
    pendingInjections.delete(sessionID)
  }

  const clearRetryCounts = (sessionID: string): void => {
    retryCounts.delete(sessionID)
  }

  return {
    handleMatches,
    getPendingInjection,
    clearPendingInjection,
    clearRetryCounts,
  }
}
