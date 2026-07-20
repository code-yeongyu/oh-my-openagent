import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { flushMicrotasks } from "./chaos-actions"
import { runIteration } from "./chaos-drive"
import { buildHarness } from "./chaos-harness"
import type { InvariantId } from "./chaos-invariants"
import { deriveSeed, hashSeed } from "./prng"

// Seeded adversarial interleaving bench. Each iteration scripts fake runners through a randomized
// mix of start/queue, completion, steer, interrupt, running/pending cancel, abortable parent waits,
// revive, eviction, reconciliation, shutdown, rpc clean/signal exit and notifier retry, then asserts:
//   (1) exactly-once notification per (task_id, run_epoch)
//   (2) terminal idempotence (no terminal overwrite; late transitions logged not applied)
//   (3) no concurrency slot leak (all slots released + queue drained when every task is terminal)
//   (4) no unhandled rejection for the whole run
//   (5) every waitFor settles and a cancelled-pending task never launches
// Rerun a single seed with SEED=<label> bun test src/__adversarial__/chaos-bench.test.ts.

const DEFAULT_SEED = "senpi-task-w1-chaos"
const ITERATIONS = 200
const INVARIANT_IDS = [1, 2, 3, 4, 5] as const satisfies readonly InvariantId[]

type RejectionRecord = { readonly iteration: number; readonly reason: string }

describe("W1-V chaos bench", () => {
  const seedLabel = process.env.SEED ?? DEFAULT_SEED
  const baseSeed = hashSeed(seedLabel)
  const rejections: RejectionRecord[] = []
  let activeIteration = -1
  const onUnhandledRejection = (reason: unknown): void => {
    rejections.push({ iteration: activeIteration, reason: reason instanceof Error ? reason.message : String(reason) })
  }

  // Invariant 4 backstop: the listener is armed for the whole run per the plan. Bun's own test
  // runner is the HARD enforcer - any floating rejection during this test fails it outright, so a
  // green run is itself proof that no iteration leaked an unhandled rejection.
  beforeAll(() => {
    process.on("unhandledRejection", onUnhandledRejection)
    console.log(`[chaos] seed=${seedLabel} base=${baseSeed} iterations=${ITERATIONS}`)
  })

  afterAll(() => {
    process.off("unhandledRejection", onUnhandledRejection)
  })

  test(
    "#given 200 randomized event interleavings #when each is driven to quiescence #then all five invariants hold",
    async () => {
      // given
      const failures: string[] = []
      expect(INVARIANT_IDS).toHaveLength(5)
      const seamHarness = buildHarness({ concurrency: 1, residencyMax: 1, maxDepth: 1 })
      try {
        expect(seamHarness.retryScheduler.pendingCount).toBe(0)
        expect(seamHarness.waiters.registrations).toBe(0)
        expect(seamHarness.waiters.settlements).toBe(0)
      } finally {
        seamHarness.cleanup()
      }

      // when
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        activeIteration = iteration
        const seed = deriveSeed(baseSeed, iteration)
        const rejectionsBefore = rejections.length
        const report = await runIteration(seed)
        await flushMicrotasks()
        await flushMicrotasks()
        for (const violation of report.violations) {
          failures.push(`iter ${iteration} seed=${seed}: inv${violation.invariant} ${violation.detail}`)
        }
        for (const record of rejections.slice(rejectionsBefore)) {
          failures.push(`iter ${iteration} seed=${seed}: inv4 unhandled rejection: ${record.reason}`)
        }
      }

      // then
      if (failures.length > 0) {
        console.error(`[chaos] ${failures.length} violation(s):\n${failures.join("\n")}`)
      }
      expect(failures).toEqual([])
    },
    120_000,
  )
})
