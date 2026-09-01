import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { FactsFailureStore, factsQueuePaths } from "@oh-my-opencode/memory-core"

import { FactsExtractorRunner } from "./facts-runner"
import { pruneTerminalFactsRuns } from "./facts-run-prune"
import { seedTerminalRun } from "./facts-run-prune.test-support"
import { fixture, onlyRunDir, runnerOptions } from "./facts-runner.test-support"
import type { FactsFailurePort } from "./facts-failure-recording"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

const ABANDONED_RUN_ID = "facts-abandoned-1"
const ABANDONED_BATCH_ID = "11111111-1111-4111-8111-111111111111"

/** A seeded record and a clock past its one-minute backoff window (todo 6 gates launches on it). */
const RECORDED_AT = new Date("2026-08-10T12:00:00.000Z")
const ELIGIBLE_AT = new Date("2026-08-10T12:01:00.000Z")

/** Reconcile-only drive: `reconcilePending` reconciles first, then refuses the follow-on launch. */
function reconcileOnly(runner: FactsExtractorRunner) {
  const stop = new AbortController()
  stop.abort()
  return runner.reconcilePending(stop.signal)
}

/** A run whose supervisor identity is unknowable and whose deadline has long passed. */
async function seedUnknownLivenessRun(factsDir: string): Promise<string> {
  const runDir = join(factsDir, "runs", ABANDONED_RUN_ID)
  await mkdir(runDir, { recursive: true })
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId: ABANDONED_RUN_ID,
    kind: "facts",
    startedAt: "2026-08-10T12:00:00.000Z",
    hardDeadlineAt: Date.parse("2026-08-10T12:01:00.000Z"),
    terminationGraceMs: 100,
    deadlineAt: Date.parse("2026-08-10T12:01:00.100Z"),
    batchId: ABANDONED_BATCH_ID,
    queued: [{ conversationId: "session-1", end_message_id: "m1", end_snapshot_line: 1 }],
  })
  return runDir
}

/**
 * Terminal-write observer. Every run dir on disk is inspected for a sentinel AT RECORD TIME - a
 * late-bound path would make the sentinel-absence assertion vacuous. The failureId is the run's
 * per-launch batchId, so it deliberately no longer names a directory.
 */
function orderingProbe(runsDir: string) {
  const observed: { readonly failureId: string; readonly sentinelExisted: boolean }[] = []
  const port: FactsFailurePort = {
    recordFailure: async (request) => {
      const names = await readdir(runsDir).catch(() => [] as string[])
      observed.push({
        failureId: request.failureId,
        sentinelExisted: names.some((name) =>
          existsSync(join(runsDir, name, "final.json")) || existsSync(join(runsDir, name, "abandoned.json"))),
      })
    },
    clearOnSuccess: async () => undefined,
  }
  return { observed, port }
}

/** The per-launch batchId a run recorded in its ledger: the failure identity, not the run name. */
async function ledgerBatchId(runDir: string): Promise<string> {
  return JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8")).batchId
}

describe("facts terminal failure recording", () => {
  test("#given a child that exits non-zero #when the run finalizes #then one streak entry is recorded for the queued endpoint", async () => {
    // given: the recorded failure identity is the run's per-launch batchId, never its dir name.
    //
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail"))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("failed")
    const store = new FactsFailureStore({ identityPaths: identity.paths })
    const state = await store.readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({
      conversationId: "session-1",
      end_message_id: "m1",
      end_snapshot_line: 1,
      state: "backoff",
      streak: 1,
      lastReason: "child_exit",
      lastFailureId: await ledgerBatchId(await onlyRunDir(identity)),
    })
    expect(await queue.listPending()).toHaveLength(1)
  }, 30_000)

  test("#given a failing run #when the failure store is written #then no terminal sentinel exists yet", async () => {
    // given: the ordering contract - a crash between the record and the sentinel is safe,
    // the reverse order would lose the increment forever.
    const { root, identity, queue } = await fixture()
    const probe = orderingProbe(join(identity.paths.facts, "runs"))
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", {
      failures: probe.port,
    }))

    // when
    const result = await runner.launchPending()
    const runDir = await onlyRunDir(identity)

    // then
    expect(result.status).toBe("failed")
    expect(probe.observed).toEqual([{ failureId: await ledgerBatchId(runDir), sentinelExisted: false }])
    expect(existsSync(join(runDir, "final.json"))).toBe(true)
  }, 30_000)

  test("#given finalize crashed after the failure record #when reconcile replays the same runId #then the streak stays at one", async () => {
    // given: the record landed, the sentinel did not - exactly the crash window the ordering buys.
    const { root, identity, queue } = await fixture()
    const crashing = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", {
      writeTerminalSentinel: async () => {
        throw new Error("injected crash between failure record and sentinel")
      },
    }))
    await expect(crashing.launchPending()).rejects.toThrow("injected crash")
    const runDir = await onlyRunDir(identity)
    expect(existsSync(join(runDir, "final.json"))).toBe(false)
    const store = new FactsFailureStore({ identityPaths: identity.paths })
    expect((await store.readFailures()).entries[0]).toMatchObject({ streak: 1 })

    // when: a fresh runner reconciles the same run dir, replaying the same runId
    await reconcileOnly(new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fail", { now: () => new Date("2026-08-11T12:00:00.000Z") }),
    ))

    // then
    expect(existsSync(join(runDir, "final.json"))).toBe(true)
    const state = await store.readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ streak: 1, lastFailureId: await ledgerBatchId(runDir) })
  }, 30_000)

  test("#given a run of unknown liveness past its deadline #when reconcile abandons it #then the failure record precedes the sentinel", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runDir = await seedUnknownLivenessRun(identity.paths.facts)
    const probe = orderingProbe(join(identity.paths.facts, "runs"))
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", {
      failures: probe.port,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    }))

    // when
    await reconcileOnly(runner)

    // then
    expect(existsSync(join(runDir, "abandoned.json"))).toBe(true)
    expect(probe.observed[0]).toEqual({ failureId: ABANDONED_BATCH_ID, sentinelExisted: false })
  }, 30_000)

  test("#given a real store #when a run is abandoned #then the queued endpoint carries the unknown_liveness reason", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await seedUnknownLivenessRun(identity.paths.facts)

    // when
    await reconcileOnly(new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", {
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    })))

    // then
    const state = await new FactsFailureStore({ identityPaths: identity.paths }).readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({
      end_message_id: "m1",
      end_snapshot_line: 1,
      streak: 1,
      lastReason: "unknown_liveness",
      lastFailureId: ABANDONED_BATCH_ID,
    })
  }, 30_000)

  test("#given a parent_dirty finalize #when the run ends #then the endpoint is recorded with the parent_dirty reason", async () => {
    // given
    const { root, identity, queue } = await fixture()
    let dirty = true
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      withWriterLock: async (operation) => {
        if (dirty) {
          dirty = false
          await writeFile(join(identity.paths.repo, "foreign.md"), "parent bytes\n")
        }
        return operation()
      },
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("parent_dirty")
    const state = await new FactsFailureStore({ identityPaths: identity.paths }).readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ streak: 1, lastReason: "parent_dirty", state: "backoff" })
  }, 30_000)

  test("#given a recorded failure #when a later run commits #then the endpoint's record is cleared after consumption", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const store = new FactsFailureStore({ identityPaths: identity.paths, now: () => RECORDED_AT })
    await store.recordFailure({
      targets: [{ conversationId: "session-1", endMessageId: "m1", endSnapshotLine: 1 }],
      failureId: "earlier-run",
      reason: "child_exit",
    })
    expect((await store.readFailures()).entries).toHaveLength(1)

    // when: past the record's backoff window, so launch gating lets the endpoint through
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => ELIGIBLE_AT }),
    ).launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(await queue.listPending()).toHaveLength(0)
    expect((await store.readFailures()).entries).toEqual([])
  }, 30_000)

  test("#given a queued endpoint with a stale record #when the run yields no facts #then the record is cleared too", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const store = new FactsFailureStore({ identityPaths: identity.paths, now: () => RECORDED_AT })
    await store.recordFailure({
      targets: [{ conversationId: "session-1", endMessageId: "m1", endSnapshotLine: 1 }],
      failureId: "earlier-run",
      reason: "invalid_extraction",
    })

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "empty", { now: () => ELIGIBLE_AT }),
    ).launchPending()

    // then
    expect(result.status).toBe("no_facts")
    expect((await store.readFailures()).entries).toEqual([])
  }, 30_000)

  test("#given the quick category cannot resolve #when a launch is attempted #then a preflight-scoped failure is recorded", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner({
      identity,
      queue,
      cwd: root,
      loadConfig: () => ({ config: { categories: {} }, diagnostics: [], layers: [], sources: [] }),
      resolveModelRegistry: () => ({ getAvailable: () => [], find: () => undefined }),
    })

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("skipped")
    const state = await new FactsFailureStore({ identityPaths: identity.paths }).readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ streak: 1, lastReason: "quick_category_unavailable" })
    expect(state.entries[0]?.lastFailureId).toMatch(/^preflight-[0-9a-f-]{36}$/)
    expect(existsSync(join(identity.paths.facts, "runs"))).toBe(false)
  }, 30_000)

  test("#given an aborted drain #when launch is refused before reservation #then nothing is recorded", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const aborted = new AbortController()
    aborted.abort()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact"))

    // when
    const result = await runner.launchPending(aborted.signal)

    // then
    expect(result.status).toBe("skipped")
    expect(existsSync(factsQueuePaths(identity.paths).failuresPath)).toBe(false)
  }, 30_000)

  test("#given five consecutive failing runs #when each finalizes #then the endpoint parks with a null eligibility", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const store = new FactsFailureStore({ identityPaths: identity.paths })

    // when
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", {
        now: () => new Date(`2026-08-1${attempt}T12:00:00.000Z`),
      }))
      expect((await runner.launchPending()).status).toBe("failed")
    }

    // then
    const state = await store.readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ state: "parked", streak: 5, nextEligibleAt: null })
    expect(await queue.listPending()).toHaveLength(1)
  }, 60_000)

  test("#given retention keeps freeing the attempt name #when six launches fail #then the streak still parks the endpoint", async () => {
    // given: the incident shape - retention evicts this digest's only run, so the retry reserves
    // the SAME `facts-<digest>-1` name. A run-name failure identity would read every genuine
    // failure as a crash replay of the pruned run and pin the streak at 1 forever.
    const { root, identity, queue } = await fixture()
    const store = new FactsFailureStore({ identityPaths: identity.paths })
    const names: string[] = []
    const statuses: string[] = []

    // when: six launches, each followed by a busier digest's newer run taking the always-kept
    // newest slot, so pruning removes this digest's trace before the next attempt.
    for (let cycle = 1; cycle <= 6; cycle += 1) {
      const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", {
        now: () => new Date(`2026-08-${10 + cycle}T12:00:00.000Z`),
      }))
      statuses.push((await runner.launchPending()).status)
      const runs = await readdir(join(identity.paths.facts, "runs"))
      names.push(...runs.filter((name) => !name.startsWith("facts-busier-")))
      await seedTerminalRun({
        factsDir: identity.paths.facts,
        runId: `facts-busier-${cycle}`,
        finishedAt: `2026-08-${10 + cycle}T13:00:00.000Z`,
      })
      await pruneTerminalFactsRuns({
        factsDir: identity.paths.facts,
        locksDir: identity.paths.locks,
        keepLast: 1,
      })
      expect(await readdir(join(identity.paths.facts, "runs"))).toEqual([`facts-busier-${cycle}`])
    }

    // then: the freed name IS handed back every cycle, yet five real failures still park the
    // endpoint and the sixth launch is refused instead of relaunching forever.
    expect(new Set(names).size).toBe(1)
    expect(statuses).toEqual(["failed", "failed", "failed", "failed", "failed", "empty"])
    const state = await store.readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ streak: 5, state: "parked", nextEligibleAt: null })
  }, 60_000)

  test("#given a run ledger #when the run reserves its directory #then queued endpoints carry their snapshot boundary", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail"))

    // when
    await runner.launchPending()

    // then
    const ledger = JSON.parse(await readFile(join(await onlyRunDir(identity), "ledger.json"), "utf8"))
    expect(ledger.queued).toEqual([{ conversationId: "session-1", end_message_id: "m1", end_snapshot_line: 1 }])
  }, 30_000)
})
