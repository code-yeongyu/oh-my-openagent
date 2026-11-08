import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { FactsFailureStore } from "@oh-my-opencode/memory-core"
import { FactsExtractorRunner } from "./facts-runner"
import { fixture, runnerOptions } from "./facts-runner.test-support"

describe("facts runner shutdown abort boundary", () => {
  test("#given an aborted drain signal #when launch is attempted #then no run is reserved, no child spawns, and the batch stays retryable", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {}))
    const aborted = new AbortController()
    aborted.abort()

    // when
    const result = await runner.launchPending(aborted.signal)

    // then
    expect(result.status).toBe("skipped")
    expect(await queue.listPending()).toHaveLength(1)
    expect(existsSync(join(identity.paths.facts, "runs"))).toBe(false)
  }, 30_000)

  test("#given an in-flight facts child #when cancelActive is requested #then it is abandoned without consuming the queue or recording a failure", async () => {
    // given
    const { root, identity, queue } = await fixture()
    let signalStart: (() => void) | undefined
    const startCalled = new Promise<void>((resolve) => { signalStart = resolve })
    let aborted = 0
    let disposed = 0
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      createRunner: () => ({
        start: async () => {
          signalStart?.()
          return {
            task_id: "facts-child",
            sessionId: "facts-child",
            effectiveModel: () => undefined,
            steer: async () => undefined,
            followUp: async () => undefined,
            abort: async () => { aborted += 1 },
            subscribe: () => () => undefined,
            waitForIdle: async () => await new Promise(() => undefined),
            lastAssistantText: () => undefined,
            dispose: () => { disposed += 1 },
          }
        },
      }),
    }))
    const launch = runner.launchPending()
    await startCalled

    // when
    await runner.cancelActive()
    const result = await launch
    const runs = await readdir(join(identity.paths.facts, "runs"))
    const runDir = join(identity.paths.facts, "runs", runs[0] ?? "missing")

    // then
    expect(result.status).toBe("failed")
    expect(aborted).toBe(1)
    expect(disposed).toBe(1)
    expect(existsSync(join(runDir, "abandoned.json"))).toBe(true)
    expect(existsSync(join(runDir, "outcome.json"))).toBe(false)
    expect(existsSync(join(runDir, "final.json"))).toBe(false)
    expect(await queue.listPending()).toHaveLength(1)
    expect((await new FactsFailureStore({ identityPaths: identity.paths }).readFailures()).entries).toHaveLength(0)
    expect(await readFile(join(runDir, "abandoned.json"), "utf8")).toContain("session_shutdown")
  }, 30_000)

  test("#given the abort fires at the batch-id hook mid-composite #when launch proceeds #then the reservation boundary refuses to start", async () => {
    // given: the abort lands mid-composite, inside the batch-id hook right before the
    // reservation boundary - the composite must stop before creating the run.
    const { root, identity, queue } = await fixture()
    const aborted = new AbortController()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      createBatchId: () => {
        aborted.abort()
        return "11111111-1111-4111-8111-111111111111"
      },
    }))

    // when
    const result = await runner.launchPending(aborted.signal)

    // then
    expect(result.status).toBe("skipped")
    expect(await queue.listPending()).toHaveLength(1)
    expect(existsSync(join(identity.paths.facts, "runs"))).toBe(false)
  }, 30_000)

  test("#given a bind-time reconcile still in flight #when cancelActive is requested #then it settles only after the reconcile stops, and the reconcile launches nothing", async () => {
    // Maintenance floats past bind. Shutdown must join its real artifact cleanup before
    // releasing the identity, even though reconcile no longer reads launch/failure eligibility.
    const { root, identity, queue } = await fixture()
    const tombstone = join(identity.paths.facts, "runs", ".prune-interrupted")
    await mkdir(tombstone, { recursive: true })
    const cleanupStarted = Promise.withResolvers<void>()
    const cleanupGate = Promise.withResolvers<void>()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      resolveModelRegistry: () => { throw new Error("maintenance must not resolve a launch model") },
      removeRunArtifact: async (path) => {
        if (path === tombstone) {
          cleanupStarted.resolve()
          await cleanupGate.promise
        }
        await rm(path, { recursive: true, force: true })
      },
    }))
    const order: string[] = []
    const reconcile = runner.reconcilePending().then((result) => { order.push("reconcile"); return result })
    await cleanupStarted.promise

    // when
    const cancel = runner.cancelActive().then(() => { order.push("cancel") })
    cleanupGate.resolve()
    await Promise.all([cancel, reconcile])

    // then
    expect(order).toEqual(["reconcile", "cancel"])
    expect((await reconcile).status).toBe("skipped")
    expect(await queue.listPending()).toHaveLength(1)
    expect(await readdir(join(identity.paths.facts, "runs"))).toEqual([])
    expect(existsSync(tombstone)).toBe(false)
    expect(existsSync(join(identity.paths.repo, ".git"))).toBe(false)
  }, 30_000)
})
