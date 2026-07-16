export function createWatchdogAbortProvenance() {
  const generationsBySession = new Map<string, Set<number>>()

  return {
    clear(sessionID: string): void {
      generationsBySession.delete(sessionID)
    },
    clearAll(): void {
      generationsBySession.clear()
    },
    record(sessionID: string, generation: number): void {
      const generations = generationsBySession.get(sessionID) ?? new Set<number>()
      generations.add(generation)
      generationsBySession.set(sessionID, generations)
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
