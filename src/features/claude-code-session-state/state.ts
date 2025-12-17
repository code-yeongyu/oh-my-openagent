export const subagentSessions = new Set<string>()

export let mainSessionID: string | undefined

export function setMainSession(id: string | undefined) {
  mainSessionID = id
}

export function getMainSessionID(): string | undefined {
  return mainSessionID
}
