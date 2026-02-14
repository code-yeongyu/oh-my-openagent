const store = new Map<string, Record<string, boolean>>()

export function setSessionTools(sessionID: string, tools: Record<string, boolean>): void {
  store.set(sessionID, { ...tools })
}

export function getSessionTools(sessionID: string): Record<string, boolean> | undefined {
  const tools = store.get(sessionID)
  return tools ? { ...tools } : undefined
}

export function clearSessionTools(): void {
  store.clear()
}
