export function createWatchdogAbortProvenance() {
  const generationsBySession = new Map<string, Set<number>>()
  const completedGenerationsBySession = new Map<string, Set<number>>()
  const latestCompletedGenerationBySession = new Map<string, number>()

  const removeCompleted = (sessionID: string, generation: number): void => {
    const completedGenerations = completedGenerationsBySession.get(sessionID)
    if (!completedGenerations) return
    completedGenerations.delete(generation)
    if (completedGenerations.size > 0) return
    completedGenerationsBySession.delete(sessionID)
    latestCompletedGenerationBySession.delete(sessionID)
  }

  return {
    clear(sessionID: string): void {
      generationsBySession.delete(sessionID)
      completedGenerationsBySession.delete(sessionID)
      latestCompletedGenerationBySession.delete(sessionID)
    },
    clearAll(): void {
      generationsBySession.clear()
      completedGenerationsBySession.clear()
      latestCompletedGenerationBySession.clear()
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
      if (currentGeneration === undefined) return
      const completedGenerations = completedGenerationsBySession.get(sessionID) ?? new Set<number>()
      completedGenerations.add(currentGeneration)
      completedGenerationsBySession.set(sessionID, completedGenerations)
      latestCompletedGenerationBySession.set(sessionID, currentGeneration)
    },
    consumeCurrent(
      sessionID: string,
      currentGeneration: number | undefined,
      fallbackPending: boolean,
    ): boolean {
      const generations = generationsBySession.get(sessionID)
      if (currentGeneration === undefined || generations === undefined) return false
      let generationToConsume: number | undefined = currentGeneration
      if (!fallbackPending) {
        if (latestCompletedGenerationBySession.get(sessionID) !== currentGeneration) return false
        const completedGenerations = completedGenerationsBySession.get(sessionID)
        if (!completedGenerations) return false
        generationToConsume = undefined
        for (const generation of completedGenerations) {
          if (
            generation <= currentGeneration
            && (generationToConsume === undefined || generation > generationToConsume)
          ) {
            generationToConsume = generation
          }
        }
      }
      if (generationToConsume === undefined) return false
      if (!generations.delete(generationToConsume)) return false
      if (generations.size === 0) generationsBySession.delete(sessionID)
      removeCompleted(sessionID, generationToConsume)
      return true
    },
    consumePrior(sessionID: string, currentGeneration: number | undefined): boolean {
      const generations = generationsBySession.get(sessionID)
      if (currentGeneration === undefined || generations === undefined) return false

      for (const generation of generations) {
        if (generation >= currentGeneration) continue
        generations.delete(generation)
        if (generations.size === 0) generationsBySession.delete(sessionID)
        removeCompleted(sessionID, generation)
        return true
      }
      return false
    },
  }
}
