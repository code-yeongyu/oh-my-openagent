const providerStateMap = new Map<string, string>()

export function setProvider(sessionID: string, providerID: string): void {
  providerStateMap.set(sessionID, providerID)
}

export function getProvider(sessionID: string): string | undefined {
  return providerStateMap.get(sessionID)
}

export function clearProvider(sessionID: string): void {
  providerStateMap.delete(sessionID)
}
