import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"

import { FactsExtractorRunner } from "./facts-runner"
import {
  activeRunId, afterMark, callerSite, cleanupStaleLockFixtures, deadPid, diagnosisMark, holderVerdict, hostDiesMidPublish, runReflect, settleTurn, staleLockFixture,
  staleRunDiagnosis,
  type DiagnosisMark,
} from "./wiring-reflection-stale-lock.test-support"

afterEach(cleanupStaleLockFixtures)

describe("memory reflection stale active lock (#10377)", () => {
  test.each([0, 1])("#given a session that already reconciled and a clock advancing %i ms per read #when the host dies mid-publish and the next /reflect finds the lock held #then the dead run is finalized and the lock released", async (tick) => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    expect(item.reconciles.count).toBe(1)
    const pid = await deadPid()
    let clock = Date.now()
    const runId = await hostDiesMidPublish(item, pid, () => {
      const now = clock
      clock += tick
      return now
    })
    const verdictBefore = await holderVerdict(item)
    const mark = diagnosisMark(item)

    // when
    const reply = await runReflect(item)

    // then: on failure the message names the branch that skipped the dead run (#11604)
    expect(await staleRunDiagnosis(item, runId, { verdictBefore, surface: reply, mark })).toBe("finalized")
    expect(await activeRunId(item)).not.toBe(runId)
    expect(reply).toContain(`the previous run ${runId} had stopped without releasing its lock`)
    const promoted = await activeRunId(item)
    if (promoted === undefined) throw new Error("expected the queued request to become the active run")
    expect(item.launched.map((run) => run.runId)).toContain(promoted)
  }, 30_000)

  test("#given a session that already reconciled #when the host dies mid-publish and a later turn settles #then the dead run is finalized", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    const pid = await deadPid()
    const runId = await hostDiesMidPublish(item, pid)
    const verdictBefore = await holderVerdict(item)
    const mark = diagnosisMark(item)

    // when
    await settleTurn(item)

    // then: on failure the message names the branch that skipped the dead run (#11604)
    const surface = item.eventCtx.notices.map((notice) => `${notice.level}: ${notice.message}`).join(" | ") || "no notices"
    expect(await staleRunDiagnosis(item, runId, { verdictBefore, surface, mark })).toBe("finalized")
    expect(await activeRunId(item)).not.toBe(runId)
    expect(item.eventCtx.notices.filter((notice) => notice.message.includes("stale lock"))).toEqual([])
  }, 30_000)

  test("#given the holder's liveness cannot be checked #when /reflect and a later turn find the lock held #then nothing is reclaimed and the stuck state is shown with the next step", async () => {
    // given
    const item = await staleLockFixture({ getPidLiveness: () => "unknown" })
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, await deadPid())
    const reconcilesBefore = item.reconciles.count

    // when
    const reply = await runReflect(item)
    await settleTurn(item)

    // then
    expect(item.reconciles.count).toBe(reconcilesBefore)
    expect(existsSync(join(item.paths.reflection, "runs", runId, "final.json"))).toBe(false)
    expect(await activeRunId(item)).toBe(runId)
    expect(reply).toContain("memory reflection is stuck on a stale lock")
    expect(reply).toContain("Next step: run /doctor")
    const shown = item.eventCtx.notices.filter((notice) => notice.message.includes("memory reflection is stuck on a stale lock"))
    expect(shown.length).toBeGreaterThanOrEqual(2)
    expect(shown.every((notice) => notice.level === "warning")).toBe(true)
  }, 30_000)

  test("#given the holder is alive #when /reflect and a later turn find the lock held #then the run is left untouched and nothing is reported", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, process.pid)
    const reconcilesBefore = item.reconciles.count

    // when
    const reply = await runReflect(item)
    await settleTurn(item)

    // then
    expect(item.reconciles.count).toBe(reconcilesBefore)
    expect(existsSync(join(item.paths.reflection, "runs", runId, "final.json"))).toBe(false)
    expect(await activeRunId(item)).toBe(runId)
    expect(reply).toContain("a run is already active and this request runs next")
    expect(item.eventCtx.notices.filter((notice) => notice.message.includes("stale lock"))).toEqual([])
  }, 30_000)

  test("#given a dead holder that recovery does not release #when later turns settle #then it is reconciled once and the stuck state is shown once", async () => {
    // given
    const item = await staleLockFixture(undefined, { reconcileReleases: false })
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, await deadPid())
    const reconcilesBefore = item.reconciles.count

    // when
    await settleTurn(item)
    await settleTurn(item)
    await settleTurn(item)

    // then
    expect(item.reconciles.count).toBe(reconcilesBefore + 1)
    expect(await activeRunId(item)).toBe(runId)
    const shown = item.eventCtx.notices.filter((notice) => notice.message.includes("memory reflection is stuck on a stale lock"))
    expect(shown).toHaveLength(1)
    expect(shown[0]?.message).toContain("recovering it did not release the lock")
  }, 30_000)

  test("#given active.lock cannot be read #when /reflect and a later turn find the lock held #then the stuck state is shown with the reason instead of failing", async () => {
    // given
    const item = await staleLockFixture({
      readText: async (path) => {
        if (path.endsWith("active.lock")) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
        return readFile(path, "utf8")
      },
    })
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, await deadPid())

    // when
    const reply = await runReflect(item)
    await settleTurn(item)

    // then
    expect(reply).toContain("active.lock could not be read (EACCES)")
    expect(reply).toContain("Next step: run /doctor")
    expect(await activeRunId(item)).toBe(runId)
    const shown = item.eventCtx.notices.filter((notice) => notice.message.includes("active.lock could not be read (EACCES)"))
    expect(shown.length).toBeGreaterThanOrEqual(1)
  }, 30_000)
})

test("#given bind reconciliation is still pending #when the stale-lock fixture is torn down #then it cannot recreate its root (#11219)", async () => {
  // given: hold the real facts reconciliation until its cancellation/settlement is requested.
  const gate = Promise.withResolvers<void>()
  let settleReconcile: () => Promise<void> = async () => {}
  const item = await staleLockFixture(undefined, {
    createFactsExtractor: (options) => {
      const runner = new FactsExtractorRunner(options)
      const pending: Promise<unknown>[] = []
      settleReconcile = async () => {
        gate.resolve()
        await Promise.all(pending)
        await runner.cancelActive()
      }
      return {
        reconcilePending: () => {
          const reconcile = gate.promise.then(() => runner.reconcilePending())
          pending.push(reconcile)
          return reconcile
        },
        launchPending: (signal, selection) => runner.launchPending(signal, selection),
        cancelActive: () => settleReconcile(),
      }
    },
  })

  // when: the same teardown afterEach uses runs before the held operation finishes.
  try {
    await cleanupStaleLockFixtures()
    await settleReconcile()

    // then: late facts pruning must not recreate the locks directory under the removed root.
    expect(existsSync(item.root)).toBe(false)
  } finally {
    gate.resolve()
    await settleReconcile()
    await rm(item.root, { recursive: true, force: true })
  }
})

test("#given a Windows stack with backslash paths #when the stale-lock diagnosis names a contention site #then the worker frame is found (#11604)", () => {
  // given
  const stack = [
    "Error",
    "    at observeContention (C:\\a\\omo\\packages\\omo-senpi\\src\\components\\memory\\wiring-reflection-stale-lock.test-support.ts:84:38)",
    "    at reconcilePrelaunch (C:\\a\\omo\\packages\\omo-senpi\\src\\components\\memory\\worker\\run-reconciliation-prelaunch.ts:30:45)",
  ].join("\n")

  // when
  const site = callerSite(stack)

  // then
  expect(site).toBe("at reconcilePrelaunch (C:\\a\\omo\\packages\\omo-senpi\\src\\components\\memory\\worker\\run-reconciliation-prelaunch.ts:30:45)")
})

test("#given a reconcile pass in flight when the mark is taken #when the diagnosis cuts the evidence #then that pass belongs before the mark (#11604)", async () => {
  // given: the mark is taken as the first settled-turn pass starts, before it returns anything.
  const item = await staleLockFixture()
  const seen: { mark?: DiagnosisMark } = {}
  item.reconciles.onStart = (pass) => {
    seen.mark ??= diagnosisMark(item)
    item.reconciles.contention.push({
      pass, read: "readState", waitTimeoutMs: 0, site: "in-flight pass",
      lockPath: join(item.paths.locks, "reflection-scheduler.lock"), owner: { pid: process.pid },
    })
    item.reconciles.errors.push({ pass, error: "in-flight error" })
  }

  // when
  await settleTurn(item)

  // then: the pass's result landed after the mark, but it started before it.
  const mark = seen.mark
  if (mark === undefined) throw new Error("expected a reconcile pass to start")
  expect(item.reconciles.results.map((entry) => entry.pass)).toEqual([mark.count])
  const after = afterMark(item, mark)
  expect(after.reconciled).toBe(0)
  expect(after.passes).toEqual([])
  expect(after.contention).toEqual([])
  expect(after.errors).toEqual([])
}, 30_000)
