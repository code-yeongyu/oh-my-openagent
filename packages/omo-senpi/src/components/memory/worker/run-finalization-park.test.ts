import { afterEach, describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { readReflectionParkFile } from "@oh-my-opencode/memory-core"

import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"
import {
  cleanupReconciliationFixtures,
  reconciliationFixture as fixture,
} from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

describe("reflection settlement feeds the park policy", () => {
  test("#given a run whose child died on a missing model #when reconciliation settles it #then the park streak records a non-retryable failure with the cause fingerprint", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger, pid: 222, processStart: "supervisor-start", childPid: 333, childProcessStart: "child-start",
    })
    await writeFile(join(item.runDir, "child-stderr.log"), 'Error: Model "quick/x" not found. Use --list-models to see available models.\n')

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      getPidLiveness: () => "dead",
    })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    const park = await readReflectionParkFile(item.identity.paths.reflection)
    expect(park.streak).toBe(1)
    expect(park.parkedAt).toBeUndefined()
    expect(park.lastFailure).toMatchObject({
      runId: "run-orphan",
      retryable: false,
      reason: "supervisor_failed",
    })
    expect(park.lastFailure?.fingerprint).toContain('Model "quick/x" not found')
  }, 30_000)

  test("#given a run whose child died on a rate limit #when reconciliation settles it #then the park streak records a retryable failure", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger, pid: 222, processStart: "supervisor-start", childPid: 333, childProcessStart: "child-start",
    })
    await writeFile(join(item.runDir, "child-stderr.log"), 'OpenAI API error (429): {"type":"usage_limit_reached"}\n')

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, getPidLiveness: () => "dead" })

    // then
    expect((await readReflectionParkFile(item.identity.paths.reflection)).lastFailure?.retryable).toBe(true)
  }, 30_000)
})
