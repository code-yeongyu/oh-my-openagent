import type { CompletionOutcome } from "./bindings"

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

export type CompletionTracker = {
  /** This runtime armed a completion for the session (`thread_report {kind: "completion"}` answered `armed`). */
  readonly arm: (durableId: string) => void
  readonly agentEnd: (durableId: string, event: AgentEndFacts) => void
  /** Writes the armed completions; a session this runtime never armed resolves `[]` without calling the store. */
  readonly settled: (durableId: string) => Promise<readonly { readonly binding_id: string; readonly cursor: number }[]>
}

/**
 * A completion is written only when the session SETTLES (`agent_settled`: no retry, compaction or
 * queued continuation will run), with the outcome of the last `agent_end` before it. An
 * `agent_end` alone never writes one, because a retry or a queued follow-up turn may still run.
 * Only a session this runtime armed reaches the store at all: every other settle - the ordinary
 * case, with nothing bound - costs no store call and never creates the gateway database.
 */
export function createCompletionTracker(settle: (durableId: string, outcome: CompletionOutcome) => Promise<readonly { readonly binding_id: string; readonly cursor: number }[]>): CompletionTracker {
  const lastOutcome = new Map<string, CompletionOutcome>()
  const armed = new Set<string>()
  return {
    arm: (durableId) => {
      armed.add(durableId)
    },
    agentEnd: (durableId, event) => {
      lastOutcome.set(durableId, completionOutcome(event))
    },
    settled: async (durableId) => {
      const outcome = lastOutcome.get(durableId)
      if (outcome === undefined) return []
      lastOutcome.delete(durableId)
      if (!armed.delete(durableId)) return []
      return await settle(durableId, outcome)
    },
  }
}
