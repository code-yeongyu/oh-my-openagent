export type SessionModel = { providerID: string; modelID: string }

const sessionModels = new Map<string, SessionModel>()
const sessionVariants = new Map<string, string>()

export function setSessionModel(sessionID: string, model: SessionModel): void {
  sessionModels.set(sessionID, model)
}

export function getSessionModel(sessionID: string): SessionModel | undefined {
  return sessionModels.get(sessionID)
}

export function clearSessionModel(sessionID: string): void {
  sessionModels.delete(sessionID)
}

export function setSessionVariant(sessionID: string, variant: string): void {
  sessionVariants.set(sessionID, variant)
}

export function getSessionVariant(sessionID: string): string | undefined {
  return sessionVariants.get(sessionID)
}

export function clearSessionVariant(sessionID: string): void {
  sessionVariants.delete(sessionID)
}
