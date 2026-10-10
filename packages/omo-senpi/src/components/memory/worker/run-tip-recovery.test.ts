import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { readMemoryReceipts } from "@oh-my-opencode/memory-core"

import { writeRunJsonAtomic } from "./run-artifacts"
import { reconcileReflectionRuns } from "./run-reconciliation"
import {
  cleanupReconciliationFixtures,
  commitOrphanWorktree,
  reconciliationFixture as fixture,
} from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

const STARTED_AT = "2026-08-10T00:00:00.000Z"
const HARD_DEADLINE_AT = Date.parse("2026-08-10T00:10:00.000Z")
const CLEAN_EXIT = {
  version: 1, runId: "run-orphan", attempt: 1, code: 0, signal: null,
  finishedAt: "2026-08-10T00:05:00.000Z", timedOut: false,
}

type Item = Awaited<ReturnType<typeof fixture>>

async function deadSupervisorRun(childExit: unknown): Promise<Item> {
  const item = await fixture()
  await commitOrphanWorktree(item)
  await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
    ...item.ledger, attempt: 1, startedAt: STARTED_AT, launching: false,
    hardDeadlineAt: HARD_DEADLINE_AT, deadlineAt: HARD_DEADLINE_AT + 100,
    pid: 222, processStart: "supervisor-start", childPid: 333, childProcessStart: "child-start",
  })
  if (childExit !== undefined) await writeFile(join(item.runDir, "child-exit.json"), JSON.stringify(childExit))
  return item
}

async function reconcile(item: Item) {
  return reconcileReflectionRuns({
    identity: item.identity,
    reservation: item.store,
    now: () => HARD_DEADLINE_AT + 60_000,
    getPidLiveness: () => "dead",
  })
}

async function events(item: Item): Promise<string[]> {
  const { receipts } = await readMemoryReceipts(item.identity.paths.runtime, {})
  return [...receipts].reverse().filter((receipt) => receipt.kind !== "facts" && receipt.runId === "run-orphan").map((receipt) => receipt.event)
}

describe("tip recovery after a dead supervisor", () => {
  test("#given this attempt's child recorded a clean exit before the deadline #when reconciled #then the tip is recovered and merged once", async () => {
    // given
    const item = await deadSupervisorRun(CLEAN_EXIT)

    // when
    const results = await reconcile(item)

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "merged" }])
    expect(existsSync(join(item.identity.paths.repo, "system", "orphan.md"))).toBe(true)
    expect(await events(item)).toEqual(["recovered", "merged"])
  }, 30_000)

  test.each([
    ["no exit record", undefined],
    ["a record that parses to null", null],
    ["a record from another attempt", { ...CLEAN_EXIT, attempt: 2 }],
    ["a record from another run", { ...CLEAN_EXIT, runId: "run-other" }],
    ["a clean exit after the hard deadline", { ...CLEAN_EXIT, finishedAt: "2026-08-10T00:11:00.000Z" }],
    ["a clean exit the bootstrap marked timed out", { ...CLEAN_EXIT, timedOut: true }],
    ["a finish time before the run started", { ...CLEAN_EXIT, finishedAt: "2000-01-01T00:00:00.000Z" }],
    ["a numeric finish time", { ...CLEAN_EXIT, finishedAt: 5 }],
    ["a non-zero exit", { ...CLEAN_EXIT, code: 1 }],
  ] as const)("#given %s #when reconciled #then nothing is recovered and the run fails without merging", async (_label, childExit) => {
    // given
    const item = await deadSupervisorRun(childExit)

    // when
    const results = await reconcile(item)

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect(existsSync(join(item.identity.paths.repo, "system", "orphan.md"))).toBe(false)
    expect(await events(item)).toEqual(["failed"])
    expect((await item.store.readState()).active).toBeUndefined()
  }, 30_000)
})
