import { renderMultipleInterrupts } from "../../features/ttsr/interrupt-template"
import type { TtsrRule, TtsrSettings } from "../../features/ttsr/types"
import { log } from "../../shared/logger"

export interface AbortRetryHandler {
  handleMatches(sessionID: string, matchedRules: TtsrRule[], settings: TtsrSettings): Promise<void>
  getPendingInjection(sessionID: string): string | undefined
  clearPendingInjection(sessionID: string): void
}

export interface AbortRetryHandlerDeps {
  abort: (sessionID: string) => Promise<void>
  promptAsync: (sessionID: string, content: string) => Promise<void>
}

export function createAbortRetryHandler(deps: AbortRetryHandlerDeps): AbortRetryHandler {
  const pendingInjections = new Map<string, string>()

  const setPendingInjection = (sessionID: string, content: string): void => {
    pendingInjections.set(sessionID, content)
  }

  const handleMatches = async (
    sessionID: string,
    matchedRules: TtsrRule[],
    settings: TtsrSettings,
  ): Promise<void> => {
    void settings
    const interruptContent = renderMultipleInterrupts(matchedRules)
    setPendingInjection(sessionID, interruptContent)

    log("[ttsr] abort-retry triggered", {
      sessionID,
      rules: matchedRules.map((rule) => rule.name),
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

  return {
    handleMatches,
    getPendingInjection,
    clearPendingInjection,
  }
}
