import { applyRandomAction, flushMicrotasks, isTerminalStatus } from "./chaos-actions"
import type { ChaosState } from "./chaos-actions"
import { buildHarness, CHAOS_SESSION } from "./chaos-harness"
import { collectInvariantViolations } from "./chaos-invariants"
import type { Violation } from "./chaos-invariants"
import { RandomSource } from "./prng"

// Force every live and queued task to a terminal outcome so the slot / queue invariant can be
// checked against a fully quiesced system. Settling every handle each round releases occupied slots
// (including revived and late-launched children) and lets the queue drain deterministically.
async function drain(state: ChaosState): Promise<void> {
  const cap = state.taskIds.length * 8 + 80
  for (let round = 0; round < cap; round += 1) {
    const before = state.harness.runner.handles.size
    for (const handle of state.harness.runner.handles.values()) {
      handle.settle({ status: "completed", finalResponse: "drain" })
    }
    state.harness.waiters.advance()
    state.harness.notifier.flushBuffered({ sessionId: CHAOS_SESSION, replaced: false })
    state.harness.notifier.reconcileFailedNotifications({ sessionId: CHAOS_SESSION, parentState: { kind: "idle" } })
    const pendingRetries = state.harness.retryScheduler.pendingCount
    if (pendingRetries > 0) state.harness.retryScheduler.run(state.rng.int(0, pendingRetries - 1))
    await flushMicrotasks()
    await flushMicrotasks()
    const records = state.harness.store.list().records
    const allTerminal = records.every((record) => isTerminalStatus(record.status))
    const anyPending = records.some((record) => record.status === "pending")
    const grew = state.harness.runner.handles.size > before
    const notificationsSettled = state.harness.retryScheduler.pendingCount === 0
      && state.harness.notifier.bufferedCount(CHAOS_SESSION) === 0
    if (allTerminal && !anyPending && !grew && notificationsSettled) break
  }
  state.harness.waiters.abortAll()
  await flushMicrotasks()
  await flushMicrotasks()
}

export type IterationReport = {
  readonly steps: number
  readonly tasks: number
  readonly violations: readonly Violation[]
}

// Run one fully-isolated chaos iteration for a given seed and return any invariant violations. The
// harness (temp state dir) is always disposed, pass or fail.
export async function runIteration(seed: number): Promise<IterationReport> {
  const rng = new RandomSource(seed)
  const concurrency = rng.int(1, 4)
  const residencyMax = rng.int(1, 4)
  const maxTasks = rng.int(3, 8)
  const harness = buildHarness({ concurrency, residencyMax, maxDepth: 2 })
  const state: ChaosState = {
    harness,
    rng,
    taskIds: [],
    background: new Map(),
    seamBreaches: [],
    observedEdges: new Set(),
    maxTasks,
  }
  try {
    const steps = rng.int(12, 30)
    for (let step = 0; step < steps; step += 1) await applyRandomAction(state)
    await drain(state)
    const violations = await collectInvariantViolations(state)
    return { steps, tasks: state.taskIds.length, violations }
  } finally {
    harness.cleanup()
  }
}
