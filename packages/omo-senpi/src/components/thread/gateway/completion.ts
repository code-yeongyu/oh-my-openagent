import type { CompletionOutcome } from "./bindings"
import { isLockWaitExceeded } from "./lock-wait"

export type AgentEndFacts = {
  readonly aborted?: boolean
  readonly messages?: readonly unknown[]
}

/** The run's outcome as the final `agent_end` reports it: an abort is `cancelled`, an assistant turn that stopped on an error is `failed`. */
export function completionOutcome(event: AgentEndFacts): CompletionOutcome {
  if (event.aborted === true) return "cancelled"
  const last = [...(event.messages ?? [])].reverse().find((message) => typeof message === "object" && message !== null && (message as { role?: unknown }).role === "assistant") as
    | { readonly stopReason?: unknown }
    | undefined
  if (last?.stopReason === "aborted") return "cancelled"
  return last?.stopReason === "error" ? "failed" : "completed"
}

type Emitted = readonly { readonly binding_id: string; readonly cursor: number }[]

export type CompletionTracker = {
  /** The session has a completion arm: `thread_report {kind: "completion"}` answered `armed`, or one was found at startup. */
  readonly arm: (durableId: string) => void
  readonly agentEnd: (durableId: string, event: AgentEndFacts) => void
  /** Writes the armed completions; a session with no arm resolves `[]` without calling the store. */
  readonly settled: (durableId: string) => Promise<Emitted>
  /** Cancels background retries (shutdown); the durable arm rows stay for the next runtime. */
  readonly dispose: () => void
}

export type CompletionTrackerOptions = {
  /** Delay before a write that failed at the store's lock-wait bound is retried (the store's busy timeout). */
  readonly retryAfterMs: () => number
  /** The store's clock, read when a run settles; arms made after it belong to a later run. Defaults to `Date.now`. */
  readonly now?: () => number
  /** A write failed; `retrying` tells whether it is retried in the background. */
  readonly onWriteFailed?: (error: unknown, retrying: boolean) => void
}

/**
 * A completion is written only when the session SETTLES (`agent_settled`: no retry, compaction or
 * queued continuation will run), with the outcome of the last `agent_end` before it. An
 * `agent_end` alone never writes one, because a retry or a queued follow-up turn may still run.
 * Only an armed session reaches the store at all: every other settle - the ordinary case, with
 * nothing bound - costs no store call and never creates the gateway database.
 *
 * The durable `completion_arms` row is the source of truth, and the in-process arm stays until
 * the row's completion is written. A write that fails at the store's lock-wait bound is retried
 * in the background after the busy timeout, with the outcome of the run that settled, until it
 * lands. Each settled run is written with its own outcome, one write at a time per session: a run
 * that settles while an earlier run's write is outstanding waits behind it, and every write consumes
 * only the arms made by the time its run settled (`armedThrough`), so a delayed or retried write never
 * takes a later run's arm with the earlier outcome.
 */
export function createCompletionTracker(settle: (durableId: string, outcome: CompletionOutcome, armedThrough: number) => Promise<Emitted>, options: CompletionTrackerOptions): CompletionTracker {
  type SettledRun = { readonly outcome: CompletionOutcome; readonly armedThrough: number; readonly generation: number | undefined }
  const now = options.now ?? Date.now
  const lastOutcome = new Map<string, CompletionOutcome>()
  const armed = new Map<string, number>()
  const writing = new Set<string>()
  // Runs that settled while an earlier run's write was outstanding, oldest first.
  const waiting = new Map<string, SettledRun[]>()
  const retries = new Map<string, ReturnType<typeof setTimeout>>()
  let generation = 0
  let disposed = false

  /** The write finished (or will not be retried): the next waiting run of the session, if it still has an arm, goes next. */
  function next(durableId: string): void {
    const queue = waiting.get(durableId) ?? []
    let run = queue.shift()
    while (run !== undefined && !armed.has(durableId)) run = queue.shift()
    if (queue.length === 0) waiting.delete(durableId)
    if (run === undefined || disposed) {
      writing.delete(durableId)
      return
    }
    // A failure is reported (and a lock-wait retried) by write itself.
    void write(durableId, run).catch(() => undefined)
  }

  async function write(durableId: string, run: SettledRun): Promise<Emitted> {
    writing.add(durableId)
    try {
      const emitted = await settle(durableId, run.outcome, run.armedThrough)
      if (armed.get(durableId) === run.generation) armed.delete(durableId)
      next(durableId)
      return emitted
    } catch (error) {
      const retrying = isLockWaitExceeded(error) && !disposed
      options.onWriteFailed?.(error, retrying)
      if (retrying) {
        const timer = setTimeout(() => {
          retries.delete(durableId)
          void write(durableId, run).catch(() => undefined)
        }, options.retryAfterMs())
        timer.unref?.()
        retries.set(durableId, timer)
      } else {
        next(durableId)
      }
      throw error
    }
  }

  return {
    arm: (durableId) => {
      armed.set(durableId, ++generation)
    },
    agentEnd: (durableId, event) => {
      lastOutcome.set(durableId, completionOutcome(event))
    },
    settled: async (durableId) => {
      const outcome = lastOutcome.get(durableId)
      if (outcome === undefined) return []
      lastOutcome.delete(durableId)
      if (!armed.has(durableId)) return []
      const run: SettledRun = { outcome, armedThrough: now(), generation: armed.get(durableId) }
      if (writing.has(durableId)) {
        waiting.set(durableId, [...(waiting.get(durableId) ?? []), run])
        return []
      }
      return await write(durableId, run)
    },
    dispose: () => {
      disposed = true
      for (const timer of retries.values()) clearTimeout(timer)
      retries.clear()
      waiting.clear()
    },
  }
}
