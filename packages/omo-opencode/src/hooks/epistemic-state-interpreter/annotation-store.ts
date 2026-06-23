import type { EpistemicAnnotation } from "./types"

const store = new Map<string, EpistemicAnnotation[]>()

export function storeAnnotations(sessionID: string, annotations: EpistemicAnnotation[]): void {
  const existing = store.get(sessionID) ?? []
  store.set(sessionID, [...existing, ...annotations])
}

export function getAnnotations(sessionID: string): EpistemicAnnotation[] {
  return store.get(sessionID) ?? []
}

export function clearAnnotations(sessionID: string): void {
  store.delete(sessionID)
}

export function _resetForTesting(): void {
  store.clear()
}
