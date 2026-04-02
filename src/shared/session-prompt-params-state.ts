export type SessionPromptParams = {
  temperature?: number
  topP?: number
  options?: Record<string, unknown>
}

const sessionPromptParams = new Map<string, SessionPromptParams>()

export function setSessionPromptParams(sessionID: string, params: SessionPromptParams): void {
  sessionPromptParams.set(sessionID, {
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.topP !== undefined ? { topP: params.topP } : {}),
    ...(params.options !== undefined ? { options: { ...params.options } } : {}),
  })
}

export function getSessionPromptParams(sessionID: string): SessionPromptParams | undefined {
  const params = sessionPromptParams.get(sessionID)
  if (!params) return undefined

  return {
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.topP !== undefined ? { topP: params.topP } : {}),
    ...(params.options !== undefined ? { options: { ...params.options } } : {}),
  }
}

export function clearSessionPromptParams(sessionID: string): void {
  sessionPromptParams.delete(sessionID)
}

export function clearAllSessionPromptParams(): void {
  sessionPromptParams.clear()
}
