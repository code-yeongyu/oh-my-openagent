export type SessionModel = { providerID: string; modelID: string }

const sessionModels = new Map<string, SessionModel>()
const fallbackSessionModels = new Map<string, {
  fallback: SessionModel
  original?: SessionModel
}>()

export function setSessionModel(sessionID: string, model: SessionModel): void {
  sessionModels.set(sessionID, model)
}

export function getSessionModel(sessionID: string): SessionModel | undefined {
  return sessionModels.get(sessionID)
}

export function clearSessionModel(sessionID: string): void {
  sessionModels.delete(sessionID)
  fallbackSessionModels.delete(sessionID)
}

export function markSessionModelFallback(sessionID: string, fallback: SessionModel): void {
  fallbackSessionModels.set(sessionID, {
    fallback,
    original: sessionModels.get(sessionID),
  })
}

export function restoreSessionModelFallback(sessionID: string, model?: SessionModel): boolean {
  const state = fallbackSessionModels.get(sessionID)
  if (!state) return false
  if (
    model &&
    (
      state.fallback.providerID !== model.providerID
      || state.fallback.modelID !== model.modelID
    )
  ) {
    return false
  }

  if (state.original) {
    sessionModels.set(sessionID, state.original)
  } else {
    sessionModels.delete(sessionID)
  }
  fallbackSessionModels.delete(sessionID)
  return true
}
