export interface PollProbeTarget {
  sessionID: string
  requiresExistenceCheck: boolean
}

export interface PollProbeResolvers {
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  verifySessionExists: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
}

export const MAX_POLL_PROBE_CONCURRENCY = 8
export const POLL_PROBE_TIMEOUT_MS = 2_500

export interface PollSessionProbeResult {
  readonly hasOutput?: boolean
  readonly sessionExists?: boolean
  readonly hasIncompleteTodos?: boolean
}

export interface PollSessionProbeBatch {
  readonly resultsBySession: ReadonlyMap<string, Promise<PollSessionProbeResult>>
}

export interface PollSessionProbeOptions {
  readonly resolvers: PollProbeResolvers
  readonly onProbeError?: (sessionID: string, probe: PollProbeName, error: unknown) => void
  /** Optional overrides retain production's bounded defaults. */
  readonly concurrency?: number
  readonly timeoutMs?: number
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

class PollProbeTimeoutError extends Error {
  readonly name = "PollProbeTimeoutError"

  constructor(timeoutMs: number) {
    super(`poll probe timed out after ${timeoutMs}ms`)
  }
}

function withProbeTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new PollProbeTimeoutError(timeoutMs)), timeoutMs)
    void operation().then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

interface ProbeSessionContext {
  readonly options: PollSessionProbeOptions
  readonly timeoutMs: number
}

async function probeSession(
  sessionID: string,
  requiresExistenceCheck: boolean,
  context: ProbeSessionContext,
): Promise<PollSessionProbeResult> {
  const { resolvers, onProbeError } = context.options
  let hasOutput: boolean
  try {
    hasOutput = await withProbeTimeout(
      () => resolvers.validateSessionHasOutput(sessionID),
      context.timeoutMs,
    )
  } catch (error) {
    onProbeError?.(sessionID, "output", error)
    return {}
  }

  if (hasOutput) {
    try {
      return {
        hasOutput,
        hasIncompleteTodos: await withProbeTimeout(
          () => resolvers.checkSessionTodos(sessionID),
          context.timeoutMs,
        ),
      }
    } catch (error) {
      onProbeError?.(sessionID, "todos", error)
      return { hasOutput }
    }
  }

  if (!requiresExistenceCheck) {
    return { hasOutput }
  }

  try {
    return {
      hasOutput,
      sessionExists: await withProbeTimeout(
        () => resolvers.verifySessionExists(sessionID),
        context.timeoutMs,
      ),
    }
  } catch (error) {
    onProbeError?.(sessionID, "existence", error)
    return { hasOutput }
  }
}

/**
 * Starts bounded read-only output and follow-up probes. A worker owns one session's
 * output-then-follow-up chain, so a slow session never creates a global wave barrier.
 * Eight concurrent sessions keep polling responsive without multiplying full-history
 * reads into an unbounded request burst.
 */
export function startPollSessionProbes(
  targets: readonly PollProbeTarget[],
  options: PollSessionProbeOptions,
): PollSessionProbeBatch {
  const existenceRequired = dedupeTargets(targets)
  const sessionIDs = [...existenceRequired.keys()]
  const resultsBySession = new Map<string, Promise<PollSessionProbeResult>>()
  const resultResolvers = new Map<string, (result: PollSessionProbeResult) => void>()
  const context: ProbeSessionContext = {
    options,
    timeoutMs: options.timeoutMs ?? POLL_PROBE_TIMEOUT_MS,
  }

  for (const sessionID of sessionIDs) {
    resultsBySession.set(sessionID, new Promise((resolve) => {
      resultResolvers.set(sessionID, resolve)
    }))
  }

  let nextSessionIndex = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const sessionID = sessionIDs[nextSessionIndex]
      nextSessionIndex += 1
      if (!sessionID) return
      const result = await probeSession(sessionID, existenceRequired.get(sessionID) === true, context)
      resultResolvers.get(sessionID)?.(result)
    }
  }
  const concurrency = Math.max(options.concurrency ?? MAX_POLL_PROBE_CONCURRENCY, 1)
  const workerCount = Math.min(concurrency, sessionIDs.length)
  void Promise.all(Array.from({ length: workerCount }, worker))

  return { resultsBySession }
}
