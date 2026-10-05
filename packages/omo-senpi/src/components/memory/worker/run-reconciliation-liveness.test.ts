import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"
import { exitedWithin, killIfAlive, captureIdentity } from "./process-liveness.test-support"
import {
  cleanupReconciliationFixtures,
  reconciliationFixture as fixture,
} from "./run-reconciliation.test-support"

const sleepers: ChildProcess[] = []

afterEach(async () => {
  for (const sleeper of sleepers.splice(0)) {
    const identity = sleeper.pid === undefined ? null : captureIdentity(sleeper.pid)
    if (identity !== null) killIfAlive(identity)
    await exitedWithin(sleeper, 5_000)
  }
  await cleanupReconciliationFixtures()
})

function spawnSleeper(): ChildProcess {
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" })
  sleepers.push(sleeper)
  return sleeper
}

describe("reconciliation against a live run whose ledger uses another start-identity scheme", () => {
  test("#given a live supervisor recorded with ps-lstart while this process reads another scheme #when reconciled within the deadline #then the run stays active and its worktree is untouched", async () => {
    // given: a real live process stands in for the supervisor and its child; the ledger carries
    // the identity scheme the supervisor wrote before this runtime switched readers.
    const item = await fixture()
    const sleeper = spawnSleeper()
    if (sleeper.pid === undefined) throw new Error("sleeper did not receive a pid")
    const now = Date.now()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger,
      launching: false,
      pid: sleeper.pid,
      processStart: "ps-lstart:Tue Sep 15 14:59:03 2026",
      childPid: sleeper.pid,
      childProcessStart: "ps-lstart:Tue Sep 15 14:59:04 2026",
      hardDeadlineAt: now + 60_000,
      deadlineAt: now + 60_000 + item.ledger.terminationGraceMs,
    })

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      waitForOutcome: async () => "timeout",
    })

    // then
    expect(results).toEqual([])
    expect(existsSync(item.worktree.dir)).toBe(true)
    expect(existsSync(join(item.runDir, "final.json"))).toBe(false)
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
  }, 30_000)
})
