export type SessionModel = { providerID: string; modelID: string }
export type StoredSessionModel = SessionModel & { agent?: string }

const sessionModels = new Map<string, StoredSessionModel>()

export function setSessionModel(sessionID: string, model: SessionModel, agent?: string): void {
  const normalizedAgent = agent?.trim()
  sessionModels.set(sessionID, normalizedAgent ? { ...model, agent: normalizedAgent } : model)
}

export function getSessionModel(sessionID: string): SessionModel | undefined {
  const storedModel = sessionModels.get(sessionID)
  if (!storedModel) return undefined

  return {
    providerID: storedModel.providerID,
    modelID: storedModel.modelID,
  }
}

export function getStoredSessionModel(sessionID: string): StoredSessionModel | undefined {
  return sessionModels.get(sessionID)
}

export function clearSessionModel(sessionID: string): void {
  sessionModels.delete(sessionID)
}
