export type EvalCellCorrelation = {
  readonly clearSession: (sessionId: string) => void
  readonly consume: (cellId: string) => string | undefined
  readonly track: (sessionId: string, cellId: string) => void
}

export function createEvalCellCorrelation(): EvalCellCorrelation {
  const ownersByCell = new Map<string, Set<string>>()
  const cellsBySession = new Map<string, Set<string>>()
  const ambiguousCells = new Set<string>()

  const discard = (cellId: string): void => {
    for (const sessionId of ownersByCell.get(cellId) ?? []) {
      const cells = cellsBySession.get(sessionId)
      cells?.delete(cellId)
      if (cells?.size === 0) cellsBySession.delete(sessionId)
    }
    ownersByCell.delete(cellId)
    ambiguousCells.delete(cellId)
  }

  return {
    clearSession: (sessionId) => {
      for (const cellId of cellsBySession.get(sessionId) ?? []) {
        const owners = ownersByCell.get(cellId)
        owners?.delete(sessionId)
        if (owners?.size === 0) {
          ownersByCell.delete(cellId)
          ambiguousCells.delete(cellId)
        }
      }
      cellsBySession.delete(sessionId)
    },
    consume: (cellId) => {
      const owners = ownersByCell.get(cellId)
      if (
        owners === undefined
        || owners.size !== 1
        || ambiguousCells.has(cellId)
      ) {
        discard(cellId)
        return undefined
      }
      const sessionId = owners.values().next().value
      discard(cellId)
      return sessionId
    },
    track: (sessionId, cellId) => {
      const owners = ownersByCell.get(cellId) ?? new Set<string>()
      owners.add(sessionId)
      ownersByCell.set(cellId, owners)
      if (owners.size > 1) ambiguousCells.add(cellId)
      const cells = cellsBySession.get(sessionId) ?? new Set<string>()
      cells.add(cellId)
      cellsBySession.set(sessionId, cells)
    },
  }
}
