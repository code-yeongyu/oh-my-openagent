import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { writeRunJsonAtomic } from "./run-artifacts"
import { reconcileReflectionRuns } from "./run-reconciliation"
import { cleanupReconciliationFixtures, reconciliationFixture as fixture } from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

const NOW = Date.parse("2026-08-10T00:10:00.000Z")
const WAITING_SUPERVISOR = 111

describe("per-turn reconcile never waits on a run's deadline (#11976, DESIGN.r3 c.15)", () => {
  test("#given a reapable dead run and a sibling whose supervisor cannot be checked #when reconciled with waitPolicy none #then the dead run settles, the sibling is left untouched and no wait seam runs (C19)", async () => {
    // given
    const item = await fixture()
    const sibling = join(item.identity.paths.reflection, "runs", "run-a-waiting")
    await mkdir(sibling, { recursive: true })
    const { processStart: _start, ...ledger } = item.ledger as unknown as Record<string, unknown>
    await writeRunJsonAtomic(join(sibling, "ledger.json"), {
      ...ledger,
      runId: "run-a-waiting",
      pid: WAITING_SUPERVISOR,
      deadlineAt: NOW + 60 * 60_000,
      hardDeadlineAt: NOW + 60 * 60_000 - 100,
    })
    const waits: string[] = []

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      hostname: () => "fixture-host",
      now: () => NOW,
      getPidLiveness: (pid) => (pid === WAITING_SUPERVISOR ? "alive" : "dead"),
      waitForOutcome: async () => {
        waits.push("outcome")
        return "timeout"
      },
      waitUntil: async () => {
        waits.push("until")
      },
      waitPolicy: "none",
    })

    // then
    expect(waits).toEqual([])
    expect(results.map((result) => result.runId)).toContain("run-orphan")
    expect(results.map((result) => result.runId)).not.toContain("run-a-waiting")
    expect((await item.store.readState()).active?.runId).not.toBe("run-orphan")
  }, 30_000)
})
