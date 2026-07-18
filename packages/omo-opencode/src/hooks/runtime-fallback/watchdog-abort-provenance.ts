export function createWatchdogAbortProvenance() {
  const generationsBySession = new Map<string, Set<number>>()
  const completedGenerationsBySession = new Map<string, Set<number>>()
  const latestCompletedGenerationBySession = new Map<string, number>()
  const pendingResponses = new Map<string, number>()

  const removeCompleted = (sessionID: string, generation: number): void => {
    const completedGenerations = completedGenerationsBySession.get(sessionID)
    if (!completedGenerations) return
    completedGenerations.delete(generation)
    if (completedGenerations.size > 0) return
    completedGenerationsBySession.delete(sessionID)
    latestCompletedGenerationBySession.delete(sessionID)
  }

  const record = (sessionID: string, generation: number): void => {
    const generations = generationsBySession.get(sessionID) ?? new Set<number>()
    generations.add(generation)
    generationsBySession.set(sessionID, generations)
  }

  const remove = (sessionID: string, generation: number): void => {
    const generations = generationsBySession.get(sessionID)
    if (!generations) return
    generations.delete(generation)
    if (generations.size === 0) generationsBySession.delete(sessionID)
    removeCompleted(sessionID, generation)
  }

  return {
    clear(sessionID: string): boolean {
      const hadProvenance = generationsBySession.has(sessionID)
        || completedGenerationsBySession.has(sessionID)
        || pendingResponses.has(sessionID)
      generationsBySession.delete(sessionID)
      completedGenerationsBySession.delete(sessionID)
      latestCompletedGenerationBySession.delete(sessionID)
      pendingResponses.delete(sessionID)
      return hadProvenance
    },
    clearAll(): void {
      generationsBySession.clear()
      completedGenerationsBySession.clear()
      latestCompletedGenerationBySession.clear()
      pendingResponses.clear()
    },
    record,
    remove,
    reserve(sessionID: string, generation: number): () => void {
      record(sessionID, generation)
      return () => remove(sessionID, generation)
    },
    markResponsePending(sessionID: string, generation: number): void { pendingResponses.set(sessionID, generation) },
    clearResponsePending(sessionID: string, generation: number): void {
      if (pendingResponses.get(sessionID) === generation) pendingResponses.delete(sessionID)
    },
    isResponsePending(sessionID: string): boolean { return pendingResponses.has(sessionID) },
    hasCurrent(sessionID: string, currentGeneration: number | undefined): boolean {
      return currentGeneration !== undefined && generationsBySession.get(sessionID)?.has(currentGeneration) === true
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

export type WatchdogAbortProvenance = ReturnType<typeof createWatchdogAbortProvenance>
