import type { SessionErrorState, SessionInterruptState } from "./types"

export const sessionErrorState = new Map<string, SessionErrorState>()
export const sessionInterruptState = new Map<string, SessionInterruptState>()
export const subagentSessions = new Set<string>()
export const sessionFirstMessageProcessed = new Set<string>()

export let currentSessionID: string | undefined
export let currentSessionTitle: string | undefined
export let mainSessionID: string | undefined

export function setCurrentSession(id: string | undefined, title: string | undefined) {
  currentSessionID = id
  currentSessionTitle = title
}

export function setMainSession(id: string | undefined) {
  mainSessionID = id
}

export function getCurrentSessionID(): string | undefined {
  return currentSessionID
}

export function getCurrentSessionTitle(): string | undefined {
  return currentSessionTitle
}

export function getMainSessionID(): string | undefined {
  return mainSessionID
}
