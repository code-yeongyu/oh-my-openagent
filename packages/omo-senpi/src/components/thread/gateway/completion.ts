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
 * lands; a settle while that write is outstanding starts no second write.
 */
export function createCompletionTracker(settle: (durableId: string, outcome: CompletionOutcome) => Promise<Emitted>, options: CompletionTrackerOptions): CompletionTracker {
  const lastOutcome = new Map<string, CompletionOutcome>()
  const armed = new Map<string, number>()
  const writing = new Set<string>()
  const retries = new Map<string, ReturnType<typeof setTimeout>>()
  let generation = 0
  let disposed = false

  async function write(durableId: string, outcome: CompletionOutcome): Promise<Emitted> {
    const armedAt = armed.get(durableId)
    writing.add(durableId)
    try {
      const emitted = await settle(durableId, outcome)
      writing.delete(durableId)
      if (armed.get(durableId) === armedAt) armed.delete(durableId)
      return emitted
    } catch (error) {
      const retrying = isLockWaitExceeded(error) && !disposed
      options.onWriteFailed?.(error, retrying)
      if (retrying) {
        const timer = setTimeout(() => {
          retries.delete(durableId)
          void write(durableId, outcome).catch(() => undefined)
        }, options.retryAfterMs())
        timer.unref?.()
        retries.set(durableId, timer)
      } else {
        writing.delete(durableId)
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
      if (!armed.has(durableId) || writing.has(durableId)) return []
      return await write(durableId, outcome)
    },
    dispose: () => {
      disposed = true
      for (const timer of retries.values()) clearTimeout(timer)
      retries.clear()
    },
  }
}
