import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { cleanupReconciliationFixtures, reconciliationFixture } from "./run-reconciliation.test-support"
import { writeRunJsonAtomic } from "./run-artifacts"
import { reconcileReflectionRuns } from "./run-reconciliation"
import { abandonReservationRun } from "./run-finalization"

afterEach(cleanupReconciliationFixtures)

test.each(["known", "unknown"] as const)("a queued live supervisor with %s start identity survives its old deadline", async (identity) => {
  const item = await reconciliationFixture()
  const ledger = {
    ...item.ledger, queued: true, launching: false, pid: 222,
    processStart: identity === "known" ? "supervisor-start" : null,
  }
  await writeRunJsonAtomic(join(item.runDir, "ledger.json"), ledger)
  const context = {
    identity: item.identity, reservation: item.store,
    now: () => Date.parse(item.ledger.startedAt) + 90_000,
    hostname: () => "fixture-host",
    getPidLiveness: (pid: number) => pid === 222 ? "alive" as const : "dead" as const,
    getProcessStartIdentity: async () => identity === "known" ? "supervisor-start" : null,
    waitForOutcome: async () => { throw new Error("queued runs must defer, not wait on an expired deadline") },
  }
  expect(await reconcileReflectionRuns(context)).toEqual([])
  expect(await abandonReservationRun(context, item.runDir, ledger)).toBeUndefined()
  expect((await item.store.readState()).active?.runId).toBe(ledger.runId)
  expect(existsSync(item.worktree.dir)).toBe(true)
  for (const marker of ["abandoned.json", "quarantined.json", "final.json"]) {
    expect(existsSync(join(item.runDir, marker))).toBe(false)
  }
})

test("a queued supervisor proven dead still settles as failed", async () => {
  const item = await reconciliationFixture()
  await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
    ...item.ledger, queued: true, pid: 222, processStart: "supervisor-start",
  })
  expect(await reconcileReflectionRuns({
    identity: item.identity, reservation: item.store, now: () => 99_000,
    hostname: () => "fixture-host",
    getPidLiveness: () => "dead",
    getProcessStartIdentity: async () => null,
  })).toEqual([{ runId: item.ledger.runId, outcome: "failed" }])
  expect((await item.store.readState()).active).toBeUndefined()
})
