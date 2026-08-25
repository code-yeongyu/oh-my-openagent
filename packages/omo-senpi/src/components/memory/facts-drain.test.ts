import { describe, expect, test } from "bun:test"

import { drainFactsLaunches } from "./facts-drain"
import { FactsExtractorRunner } from "./facts-runner"
import { enqueue, fixture, runnerOptions } from "./facts-runner.test-support"
import type { FactsLaunchResult } from "./facts-runner-types"

/** Scripted launch outcomes: the drain is exercised on injected results, never on timing. */
function scripted(results: readonly FactsLaunchResult[]): {
  readonly attempt: () => Promise<FactsLaunchResult>
  readonly calls: () => number
} {
  let calls = 0
  return {
    attempt: async () => {
      const result = results[calls] ?? { status: "empty" as const }
      calls += 1
      return result
    },
    calls: () => calls,
  }
}

describe("facts post-success drain", () => {
  test("#given a 3-batch backlog #when a drain runs #then it launches exactly 3 times and stops at the empty selection", async () => {
    // given: three successful capped runs, then nothing left to select.
    const script = scripted([
      { status: "committed", runId: "facts-1", sha: "aaa" },
      { status: "no_facts", runId: "facts-2" },
      { status: "committed", runId: "facts-3", sha: "bbb" },
      { status: "empty" },
    ])

    // when
    const result = await drainFactsLaunches(script.attempt)

    // then: the 4th call is the empty probe that ends the drain; no 5th attempt happens.
    expect(script.calls()).toBe(4)
    // The caller still hears about the run IT triggered, not the terminal empty probe.
    expect(result).toEqual({ status: "committed", runId: "facts-1", sha: "aaa" })
  })

  test("#given a failure mid-drain #when the drain runs #then it stops on the failure and never attempts again", async () => {
    // given: the second batch fails - the backoff contract owns pacing from there.
    const script = scripted([
      { status: "committed", runId: "facts-1", sha: "aaa" },
      { status: "failed", runId: "facts-2" },
      { status: "committed", runId: "facts-3", sha: "ccc" },
    ])

    // when
    const result = await drainFactsLaunches(script.attempt)

    // then
    expect(script.calls()).toBe(2)
    expect(result).toEqual({ status: "committed", runId: "facts-1", sha: "aaa" })
  })

  test("#given an aborted signal mid-drain #when the drain continues #then it stops without another attempt", async () => {
    // given
    const controller = new AbortController()
    let calls = 0
    const attempt = async (): Promise<FactsLaunchResult> => {
      calls += 1
      controller.abort()
      return { status: "committed", runId: `facts-${calls}`, sha: "ddd" }
    }

    // when
    const result = await drainFactsLaunches(attempt, controller.signal)

    // then
    expect(calls).toBe(1)
    expect(result).toEqual({ status: "committed", runId: "facts-1", sha: "ddd" })
  })

  test("#given a drain already running #when a second caller launches #then only one launch is active and the queue still drains", async () => {
    // given: two queued batches that cannot share one payload-capped run.
    const { root, identity, queue } = await fixture()
    await enqueue(queue, identity, "session-2", "m2", "The runner drains after success.")
    let concurrent = 0
    let maxConcurrent = 0
    const options = runnerOptions(root, identity, queue, "fact")
    const runner = new FactsExtractorRunner({
      ...options,
      sandbox: (args) => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        const spawned = options.sandbox?.(args) ?? args
        concurrent -= 1
        return spawned
      },
    })

    // when: a second caller arrives while the first drain holds the latch.
    const first = runner.launchPending()
    const second = await runner.launchPending()
    const drained = await first

    // then: the re-entrant caller is refused, and the drain empties the queue.
    expect(second).toEqual({ status: "active" })
    expect(maxConcurrent).toBe(1)
    expect(drained.status).toBe("committed")
    expect(await queue.listPending()).toHaveLength(0)
  }, 60_000)
})
