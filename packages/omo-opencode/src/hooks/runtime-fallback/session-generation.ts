import type { HookDeps } from "./types"

type SessionGenerations = {
  nextGeneration: number
  readonly current: Map<string, number>
  readonly currentUserMessageIDs: Map<string, string>
}

const generationsByHook = new WeakMap<HookDeps, SessionGenerations>()

function getGenerations(deps: HookDeps): SessionGenerations {
  const existing = generationsByHook.get(deps)
  if (existing) return existing

  const generations = {
    nextGeneration: 0,
    current: new Map<string, number>(),
    currentUserMessageIDs: new Map<string, string>(),
  }
  generationsByHook.set(deps, generations)
  return generations
}

export function getSessionGeneration(deps: HookDeps, sessionID: string): number {
  const generations = getGenerations(deps)
  const current = generations.current.get(sessionID)
  if (current !== undefined) return current

  generations.nextGeneration += 1
  generations.current.set(sessionID, generations.nextGeneration)
  return generations.nextGeneration
}

export function bumpSessionGeneration(deps: HookDeps, sessionID: string): number {
  const generations = getGenerations(deps)
  generations.nextGeneration += 1
  generations.current.set(sessionID, generations.nextGeneration)
  return generations.nextGeneration
}

export function advanceSessionGenerationForUserMessage(
  deps: HookDeps,
  sessionID: string,
  messageID: string | undefined,
): boolean {
  const generations = getGenerations(deps)
  if (messageID && generations.currentUserMessageIDs.get(sessionID) === messageID) {
    return false
  }

  if (messageID) generations.currentUserMessageIDs.set(sessionID, messageID)
  bumpSessionGeneration(deps, sessionID)
  return true
}

export function invalidateSessionGeneration(deps: HookDeps, sessionID: string): void {
  const generations = getGenerations(deps)
  generations.current.delete(sessionID)
  generations.currentUserMessageIDs.delete(sessionID)
}

export function isSessionGenerationCurrent(
  deps: HookDeps,
  sessionID: string,
  generation: number,
): boolean {
  return getGenerations(deps).current.get(sessionID) === generation
}

export function clearSessionGenerations(deps: HookDeps): void {
  generationsByHook.delete(deps)
}
