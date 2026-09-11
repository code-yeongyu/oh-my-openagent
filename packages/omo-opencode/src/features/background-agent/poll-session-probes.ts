export interface PollProbeTarget {
  sessionID: string
  requiresExistenceCheck: boolean
}

export interface PollProbeResolvers {
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  verifySessionExists: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
}

export interface PollProbeResults {
  hasOutput: ReadonlyMap<string, boolean>
  sessionExists: ReadonlyMap<string, boolean>
  hasIncompleteTodos: ReadonlyMap<string, boolean>
}

function dedupeTargets(targets: readonly PollProbeTarget[]): Map<string, boolean> {
  const existenceRequired = new Map<string, boolean>()
  for (const target of targets) {
    const previous = existenceRequired.get(target.sessionID)
    existenceRequired.set(target.sessionID, (previous ?? false) || target.requiresExistenceCheck)
  }
  return existenceRequired
}

export type PollProbeName = "output" | "todos" | "existence"

/**
 * Resolves the read-only session probes a polling tick needs, in two parallel waves
 * instead of one round trip per task.
 *
 * A probe that rejects leaves its entry unset. Callers treat an unset entry as
 * "unresolved this tick" and skip the task, which is what the previous per-task
 * try/catch did.
 */
export async function resolvePollSessionProbes(
  targets: readonly PollProbeTarget[],
  resolvers: PollProbeResolvers,
  onProbeError?: (sessionID: string, probe: PollProbeName, error: unknown) => void,
): Promise<PollProbeResults> {
  const hasOutput = new Map<string, boolean>()
  const sessionExists = new Map<string, boolean>()
  const hasIncompleteTodos = new Map<string, boolean>()

  if (targets.length === 0) {
    return { hasOutput, sessionExists, hasIncompleteTodos }
  }

  const existenceRequired = dedupeTargets(targets)
  const sessionIDs = [...existenceRequired.keys()]

  await Promise.all(sessionIDs.map(async (sessionID) => {
    try {
      hasOutput.set(sessionID, await resolvers.validateSessionHasOutput(sessionID))
    } catch (error) {
      onProbeError?.(sessionID, "output", error)
    }
  }))

  await Promise.all(sessionIDs.map(async (sessionID) => {
    const outputResult = hasOutput.get(sessionID)
    if (outputResult === undefined) return

    if (outputResult) {
      try {
        hasIncompleteTodos.set(sessionID, await resolvers.checkSessionTodos(sessionID))
      } catch (error) {
        onProbeError?.(sessionID, "todos", error)
      }
      return
    }

    if (existenceRequired.get(sessionID) !== true) return

    try {
      sessionExists.set(sessionID, await resolvers.verifySessionExists(sessionID))
    } catch (error) {
      onProbeError?.(sessionID, "existence", error)
    }
  }))

  return { hasOutput, sessionExists, hasIncompleteTodos }
}
