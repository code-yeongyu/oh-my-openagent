import type { ModelProvider } from "../config/schema/provider-models"

const sessionProviderPins = new Map<string, ModelProvider>()

/** Child sessions started by look_at or task with an explicit provider; fallback and override hooks leave their model alone. */
export const ProviderPinRegistry = {
  register: (sessionID: string, provider: ModelProvider): void => {
    sessionProviderPins.set(sessionID, provider)
  },

  get: (sessionID: string): ModelProvider | undefined => {
    return sessionProviderPins.get(sessionID)
  },

  has: (sessionID: string): boolean => {
    return sessionProviderPins.has(sessionID)
  },

  remove: (sessionID: string): void => {
    sessionProviderPins.delete(sessionID)
  },

  clear: (): void => {
    sessionProviderPins.clear()
  },
}
