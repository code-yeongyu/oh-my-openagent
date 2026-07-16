export function createWatchdogAbortProvenance() {
  const generationsBySession = new Map<string, Set<number>>()
  const completedGenerationBySession = new Map<string, number>()

  return {
    clear(sessionID: string): void {
      generationsBySession.delete(sessionID)
      completedGenerationBySession.delete(sessionID)
    },
    clearAll(): void {
      generationsBySession.clear()
      completedGenerationBySession.clear()
    },
    record(sessionID: string, generation: number): void {
      const generations = generationsBySession.get(sessionID) ?? new Set<number>()
      generations.add(generation)
      generationsBySession.set(sessionID, generations)
    },
    hasPrior(sessionID: string, currentGeneration: number | undefined): boolean {
      const generations = generationsBySession.get(sessionID)
      if (currentGeneration === undefined || generations === undefined) return false
      for (const generation of generations) {
        if (generation < currentGeneration) return true
      }
      return false
    },
    markCurrentCompleted(sessionID: string, currentGeneration: number | undefined): void {
      if (currentGeneration !== undefined) completedGenerationBySession.set(sessionID, currentGeneration)
    },
    consumeCurrent(
      sessionID: string,
      currentGeneration: number | undefined,
      fallbackPending: boolean,
    ): boolean {
      const generations = generationsBySession.get(sessionID)
      if (currentGeneration === undefined || generations === undefined) return false
      if (!fallbackPending && completedGenerationBySession.get(sessionID) !== currentGeneration) return false
      if (!generations.delete(currentGeneration)) return false
      if (generations.size === 0) generationsBySession.delete(sessionID)
      completedGenerationBySession.delete(sessionID)
      return true
    },
    consumePrior(sessionID: string, currentGeneration: number | undefined): boolean {
      const generations = generationsBySession.get(sessionID)
      if (currentGeneration === undefined || generations === undefined) return false

      for (const generation of generations) {
        if (generation >= currentGeneration) continue
        generations.delete(generation)
        if (generations.size === 0) generationsBySession.delete(sessionID)
        return true
      }
      return false
    },
  }
}
