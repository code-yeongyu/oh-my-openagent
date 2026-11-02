/**
 * Tells the engine's session lifecycle (senpi#3864) when this session's ulw-loop plan reaches its stop condition,
 * `aggregateCompletion.status === "complete"`, so the epoch's `done` reads `completion.kind = "run"` (#10782 item 5).
 * A loop that ends by its contract also completes the engine goal, which the engine records itself and prefers; this
 * covers a plan that completes without that goal flip.
 *
 * Only a transition this session observed counts: the plan was read here while still running, or it did not exist yet
 * the first time this session read the status. A plan already complete at the first read was finished by an earlier
 * run and is not this epoch's completion. A plan is identified by its `createdAt`, which a reset replaces. Each plan is
 * reported once per session; the engine also ignores a repeated run id.
 */
export interface PlanSnapshot {
  readonly createdAt: string | undefined
  readonly aggregateComplete: boolean
}

export interface RunCompletionTracker {
  /**
   * `plan` is a successful session-scoped status read; `undefined` means the read positively showed there is no plan.
   * A failed or unparseable read is unknown and must not be observed at all.
   */
  observe(plan: PlanSnapshot | undefined): void
}

export function createRunCompletionTracker(markRunCompleted: (runId: string) => void): RunCompletionTracker {
  const seenRunning = new Set<string>()
  const seenComplete = new Set<string>()
  let readBefore = false

  return {
    observe(plan) {
      const firstRead = !readBefore
      readBefore = true
      if (plan === undefined || plan.createdAt === undefined) return
      const id = plan.createdAt
      if (!plan.aggregateComplete) {
        seenRunning.add(id)
        return
      }
      if (seenComplete.has(id)) return
      seenComplete.add(id)
      if (!seenRunning.has(id) && firstRead) return
      markRunCompleted(`ulw-loop:${id}`)
    },
  }
}
