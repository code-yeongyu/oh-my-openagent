import { afterEach, describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"
import {
  cleanupReconciliationFixtures,
  reconciliationFixture as fixture,
} from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

async function completionRecord(item: Awaited<ReturnType<typeof fixture>>): Promise<{ reason?: string; detail?: string }> {
  return JSON.parse(await readFile(join(item.identity.paths.reflection, "completions", "run-orphan.json"), "utf8"))
}

describe("failure detail of a run reconciled after its supervisor died", () => {
  test("#given a dead supervisor and child that left a stderr tail #when reconciled #then the completion detail carries that tail", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger, pid: 222, processStart: "supervisor-start", childPid: 333, childProcessStart: "child-start",
    })
    await writeFile(join(item.runDir, "child-stderr.log"), "OpenAI API error (429): usage_limit_reached\n")

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      getPidLiveness: () => "dead",
    })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    const record = await completionRecord(item)
    expect(record.reason).toBe("supervisor_failed")
    expect(record.detail).toContain("OpenAI API error (429): usage_limit_reached")
  }, 30_000)

  test("#given a dead supervisor and child that wrote nothing #when reconciled #then the completion detail still names the dead processes", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger, pid: 222, processStart: "supervisor-start", childPid: 333, childProcessStart: "child-start",
    })

    // when
    await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      getPidLiveness: () => "dead",
    })

    // then
    const record = await completionRecord(item)
    expect(record.reason).toBe("supervisor_failed")
    expect(record.detail).toBeDefined()
    expect(record.detail?.trim().length ?? 0).toBeGreaterThan(0)
  }, 30_000)
})
