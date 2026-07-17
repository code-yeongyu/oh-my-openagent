import type { HookDeps } from "./types"

type SessionGenerations = {
  nextGeneration: number
  readonly current: Map<string, number>
}

const generationsByHook = new WeakMap<HookDeps, SessionGenerations>()

function getGenerations(deps: HookDeps): SessionGenerations {
  const existing = generationsByHook.get(deps)
  if (existing) return existing

  const generations = { nextGeneration: 0, current: new Map<string, number>() }
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

export function invalidateSessionGeneration(deps: HookDeps, sessionID: string): void {
  getGenerations(deps).current.delete(sessionID)
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
