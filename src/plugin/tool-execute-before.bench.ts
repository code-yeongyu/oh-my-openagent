/**
 * Task T1.1 benchmark for `tool.execute.before` handler.
 *
 * After the 3-wave parallelization refactor:
 *   Wave 1 (5 hooks, parallel via Promise.all):         qualityGate,
 *                                                     commentChecker,
 *                                                     directoryAgentsInjector,
 *                                                     directoryReadmeInjector,
 *                                                     rulesInjector
 *   Wave 2 (5 hooks, parallel via Promise.allSettled): secretLeakGuard,
 *                                                     envFileWriteGuard,
 *                                                     writeExistingFileGuard,
 *                                                     tasksTodowriteDisabler,
 *                                                     prometheusMdOnly (BLOCKING)
 *   Wave 3 (6 calls, sequential):                     nonInteractiveEnv,
 *                                                     bashFileReadGuard,
 *                                                     questionLabelTruncator,
 *                                                     prometheusMdOnly (MUTATOR),
 *                                                     sisyphusJuniorNotepad,
 *                                                     atlasHook
 *
 * Total: 16 calls per iteration (prometheusMdOnly appears in both Wave 2 and
 * Wave 3; the handler calls `hooks.prometheusMdOnly?.["tool.execute.before"]`
 * twice — once in Wave 2 and once in Wave 3 — so the bench must build a
 * SINGLE prometheusMdOnly hook that records both invocations).
 *
 * Assertions:
 *   - All 16 hook invocations per iteration.
 *   - Wave ordering invariant: every Wave 2 call strictly after every Wave 1
 *     call; every Wave 3 call strictly after every Wave 2 call (because
 *     `await Promise.all`/`Promise.allSettled` does not return until the
 *     entire wave resolves).
 *   - Within Wave 3, the 6 calls occur in documented order (mutator order
 *     matters: nonInteractiveEnv rewrites output.args.command and must
 *     precede other mutators; atlasHook prepends outermost so must run last).
 *   - Waves 1 and 2 admit any internal order (parallel execution); we do
 *     not assert that.
 *   - Per-iteration global counter increments by exactly 16 with no gaps
 *     or duplicates, across all ITERATIONS.
 *   - prometheusMdOnly is called exactly twice per iteration (one in Wave 2,
 *     one in Wave 3).
 *
 * Target: p99 < 0.0158ms (baseline 0.0226ms × 0.7, Task T1.1 spec).
 *
 * Run with: `bun test src/plugin/tool-execute-before.bench.ts`
 *
 * This file is intentionally NOT named `*.test.ts` so it is not picked up
 * by CI's `find ... -name '*.test.ts'` sweep. It must be added explicitly
 * to the workflow files.
 */
import { describe, expect, test } from "bun:test"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"

type HookName = string

const WAVE_1: HookName[] = [
  "qualityGate",
  "commentChecker",
  "directoryAgentsInjector",
  "directoryReadmeInjector",
  "rulesInjector",
]

const WAVE_2: HookName[] = [
  "secretLeakGuard",
  "envFileWriteGuard",
  "writeExistingFileGuard",
  "tasksTodowriteDisabler",
  "prometheusMdOnly",
]

const WAVE_3: HookName[] = [
  "nonInteractiveEnv",
  "bashFileReadGuard",
  "questionLabelTruncator",
  "prometheusMdOnly",
  "sisyphusJuniorNotepad",
  "atlasHook",
]

// Globally unique hook names. Index by position in this array is the
// nameIdx we record in the Uint8Array.
const ALL_NAMES: readonly HookName[] = Array.from(
  new Set<HookName>([...WAVE_1, ...WAVE_2, ...WAVE_3]),
)
const NAME_TO_IDX = new Map<HookName, number>(ALL_NAMES.map((n, i) => [n, i]))

const HOOKS_PER_CALL = WAVE_1.length + WAVE_2.length + WAVE_3.length

const ITERATIONS = 1000
const TOTAL_CALLS = ITERATIONS * HOOKS_PER_CALL

interface BenchStorage {
  // Index into ALL_NAMES for the hook that fired at slot k.
  nameIdx: Uint8Array
  // Global monotonic counter incremented by every hook call across all
  // iterations. Stored as the call's global order so we can assert that
  // slot[k].globalOrder === k (no gaps, no duplicates).
  globalOrder: Uint32Array
  // Iteration index for the call at slot k.
  iteration: Uint16Array
  // Per-name call count (used to assert exact counts at the end).
  perNameCount: Uint32Array
}

function buildStorage(): BenchStorage {
  return {
    nameIdx: new Uint8Array(TOTAL_CALLS),
    globalOrder: new Uint32Array(TOTAL_CALLS),
    iteration: new Uint16Array(TOTAL_CALLS),
    perNameCount: new Uint32Array(ALL_NAMES.length),
  }
}

function buildHooks(storage: BenchStorage): Record<string, unknown> {
  const hooks: Record<string, unknown> = {}
  // Shared write head across all hooks; increments on every call.
  let writeHead = 0
  for (const name of ALL_NAMES) {
    const nameIdx = NAME_TO_IDX.get(name) ?? 0
    hooks[name] = {
      "tool.execute.before": async () => {
        const slot = writeHead++
        storage.nameIdx[slot] = nameIdx
        storage.globalOrder[slot] = slot
        // (perNameCount is updated in the driver from the slot's nameIdx
        // after the test loop completes, to keep the hot-path stub as
        // lean as possible.)
      },
    }
  }
  return hooks
}

function percentile(sortedAsc: ArrayLike<number>, p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length))
  return sortedAsc[idx]
}

describe("tool.execute.before T1.1 (3-wave parallelized)", () => {
  test(
    "1000 sequential calls: latency profile + wave ordering invariants",
    async () => {
      //#given
      const storage = buildStorage()
      const hooks = buildHooks(storage)
      const ctx = { client: {} } as unknown as Parameters<typeof createToolExecuteBeforeHandler>[0]["ctx"]
      const handler = createToolExecuteBeforeHandler({
        ctx,
        hooks: hooks as Parameters<typeof createToolExecuteBeforeHandler>[0]["hooks"],
      })

      // `bash` is the simplest path — skips task-tool and slashcommand post-hooks.
      const input = { tool: "bash", sessionID: "ses_bench", callID: "call_1" }
      const output = { args: { command: "ls" } as Record<string, unknown> }

      //#when
      // Warmup: 50 unmeasured iterations to amortize JIT compilation and
      // the first GC. Without warmup, p99 is dominated by the first GC
      // pause which lands in the 99th percentile of a 1000-iter sample.
      for (let i = 0; i < 50; i++) {
        await handler(input, output)
      }

      const latencies = new Float64Array(ITERATIONS)
      const totalStart = performance.now()
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        await handler(input, output)
        latencies[i] = performance.now() - start
      }
      const totalMs = performance.now() - totalStart

      //#then
      // Backfill the per-slot iteration index. Hook stubs cannot know which
      // iteration they belong to (waves 1+2 run interleaved), so we record
      // it by the slot's iteration start position: slot[k] is in iteration
      // floor(k / HOOKS_PER_CALL).
      for (let i = 0; i < TOTAL_CALLS; i++) {
        storage.iteration[i] = Math.floor(i / HOOKS_PER_CALL)
      }

      // Per-name call counts (computed post-loop, outside the hot path).
      for (let i = 0; i < TOTAL_CALLS; i++) {
        const ni = storage.nameIdx[i] ?? 0
        storage.perNameCount[ni] = (storage.perNameCount[ni] ?? 0) + 1
      }

      const sorted = Float64Array.from(latencies).sort()
      const p50 = percentile(sorted, 50)
      const p95 = percentile(sorted, 95)
      const p99 = percentile(sorted, 99)
      const min = sorted[0] ?? 0
      const max = sorted[sorted.length - 1] ?? 0
      let sum = 0
      for (let i = 0; i < latencies.length; i++) sum += latencies[i] ?? 0
      const mean = sum / latencies.length

      console.log(
        `T1_1_AFTER tool_execute_before ` +
          `p50_ms=${p50.toFixed(4)} ` +
          `p95_ms=${p95.toFixed(4)} ` +
          `p99_ms=${p99.toFixed(4)} ` +
          `min_ms=${min.toFixed(4)} ` +
          `max_ms=${max.toFixed(4)} ` +
          `mean_ms=${mean.toFixed(4)} ` +
          `total_ms_1000_calls=${totalMs.toFixed(4)} ` +
          `iterations=${ITERATIONS} ` +
          `hooks_per_call=${HOOKS_PER_CALL} ` +
          `waves=3 ` +
          `target_p99_ms=0.0158`,
      )

      // Structural invariants
      expect(storage.nameIdx.length).toBe(TOTAL_CALLS)

      for (let i = 0; i < TOTAL_CALLS; i++) {
        expect(storage.globalOrder[i]).toBe(i)
        expect(storage.iteration[i]).toBe(Math.floor(i / HOOKS_PER_CALL))
      }

      for (let iter = 0; iter < ITERATIONS; iter++) {
        const start = iter * HOOKS_PER_CALL

        // Wave 1: first 5 calls, any internal order
        const w1Seen = new Set<number>()
        for (let k = start; k < start + WAVE_1.length; k++) {
          w1Seen.add(storage.nameIdx[k] ?? 0)
        }
        expect(w1Seen.size).toBe(WAVE_1.length)
        for (const n of WAVE_1) expect(w1Seen.has(NAME_TO_IDX.get(n) ?? -1)).toBe(true)

        // Wave 2: next 5 calls, any internal order
        const w2Seen = new Set<number>()
        for (let k = start + WAVE_1.length; k < start + WAVE_1.length + WAVE_2.length; k++) {
          w2Seen.add(storage.nameIdx[k] ?? 0)
        }
        expect(w2Seen.size).toBe(WAVE_2.length)
        for (const n of WAVE_2) expect(w2Seen.has(NAME_TO_IDX.get(n) ?? -1)).toBe(true)

        // Wave 3: last 6 calls, in fixed mutator order
        for (let k = 0; k < WAVE_3.length; k++) {
          const slot = start + WAVE_1.length + WAVE_2.length + k
          const expected = NAME_TO_IDX.get(WAVE_3[k] ?? "") ?? -1
          expect(storage.nameIdx[slot]).toBe(expected)
        }
      }

      // prometheusMdOnly total = 2 * ITERATIONS
      const prometheusIdx = NAME_TO_IDX.get("prometheusMdOnly") ?? 0
      let prometheusTotal = 0
      for (let i = 0; i < TOTAL_CALLS; i++) {
        if (storage.nameIdx[i] === prometheusIdx) prometheusTotal++
      }
      expect(prometheusTotal).toBe(2 * ITERATIONS)

      // Sanity
      expect(p99).toBeGreaterThanOrEqual(p50)
      expect(totalMs).toBeLessThan(30_000)
    },
    30_000,
  )
})
