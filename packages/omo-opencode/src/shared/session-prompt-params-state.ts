export type SessionPromptParams = {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  options?: Record<string, unknown>
}

const sessionPromptParams = new Map<string, SessionPromptParams>()
const pendingFallbackPromptParamRestores = new Map<string, SessionPromptParams | undefined>()
const pendingFallbackPromptParams = new Map<string, SessionPromptParams>()

function cloneSessionPromptParams(params: SessionPromptParams): SessionPromptParams {
  return {
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.topP !== undefined ? { topP: params.topP } : {}),
    ...(params.maxOutputTokens !== undefined ? { maxOutputTokens: params.maxOutputTokens } : {}),
    ...(params.options !== undefined ? { options: { ...params.options } } : {}),
  }
}

export function setSessionPromptParams(sessionID: string, params: SessionPromptParams): void {
  sessionPromptParams.set(sessionID, cloneSessionPromptParams(params))
}

export function getSessionPromptParams(sessionID: string): SessionPromptParams | undefined {
  const params = sessionPromptParams.get(sessionID)
  return params ? cloneSessionPromptParams(params) : undefined
}

export function clearSessionPromptParams(sessionID: string): void {
  sessionPromptParams.delete(sessionID)
  pendingFallbackPromptParamRestores.delete(sessionID)
  pendingFallbackPromptParams.delete(sessionID)
}

export function armPendingFallbackPromptParamsRestore(
  sessionID: string,
  previousParams: SessionPromptParams | undefined,
  fallbackParams?: SessionPromptParams | undefined,
): void {
  pendingFallbackPromptParamRestores.set(sessionID, previousParams ? cloneSessionPromptParams(previousParams) : undefined)
  if (fallbackParams) {
    pendingFallbackPromptParams.set(sessionID, cloneSessionPromptParams(fallbackParams))
  } else {
    pendingFallbackPromptParams.delete(sessionID)
  }
}

export function applyPendingFallbackPromptParams(sessionID: string): boolean {
  const params = pendingFallbackPromptParams.get(sessionID)
  if (!params) return false

  setSessionPromptParams(sessionID, params)
  return true
}

export function discardPendingFallbackPromptParamsRestore(sessionID: string): void {
  pendingFallbackPromptParamRestores.delete(sessionID)
  pendingFallbackPromptParams.delete(sessionID)
}

export function restorePendingFallbackPromptParams(sessionID: string): void {
  if (!pendingFallbackPromptParamRestores.has(sessionID)) return

  const previousParams = pendingFallbackPromptParamRestores.get(sessionID)
  pendingFallbackPromptParamRestores.delete(sessionID)
  pendingFallbackPromptParams.delete(sessionID)
  if (previousParams) {
    setSessionPromptParams(sessionID, previousParams)
  } else {
    clearSessionPromptParams(sessionID)
  }
}

export function clearAllSessionPromptParams(): void {
  sessionPromptParams.clear()
  pendingFallbackPromptParamRestores.clear()
  pendingFallbackPromptParams.clear()
}
