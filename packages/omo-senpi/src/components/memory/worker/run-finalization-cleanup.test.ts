import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"

import { createNodeGitExec } from "@oh-my-opencode/memory-core"

import { finalizeRecordedOutcome } from "./run-finalization"
import { failReservationRun } from "./run-finalization"
import {
  cleanupFinalizationFixtures,
  finalizationFixture as fixture,
} from "./run-finalization.test-support"
import { parseReservationRunLedger } from "./reservation-run-ledger"

const exec = createNodeGitExec()

afterEach(cleanupFinalizationFixtures)

/** Checking the run branch out elsewhere makes `git branch -D` refuse, exactly as a wedged host does. */
async function pinRunBranch(item: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const pinned = await exec.run(
    ["worktree", "add", "--force", join(item.root, "branch-pin"), item.ledger.worktreeBranch],
    { cwd: item.repo.dir, timeoutMs: 30_000 },
  )
  if (pinned.code !== 0) throw new Error(`could not pin the run branch: ${pinned.stderr}`)
}

async function readLedger(runDir: string) {
  return parseReservationRunLedger(JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8")))
}

describe("reflection finalization cleanup incompleteness", () => {
  test("#given a landed merge whose branch cannot be deleted #when the outcome finalizes #then it settles merged and records the incomplete cleanup", async () => {
    // given
    const item = await fixture()
    await pinRunBranch(item)
    const completed: string[] = []

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: {
        readState: async () => await item.store.readState(),
        complete: async (runId, outcome) => {
          completed.push(`${runId}:${outcome}`)
          return await item.store.complete(runId, outcome)
        },
      },
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
      withWriterLock: async (operation) => operation(),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("merged")
    expect(completed).toEqual(["run-1:merged"])
    expect(JSON.parse(await readFile(join(item.runDir, "final.json"), "utf8"))).toMatchObject({ outcome: "merged" })
    expect((await readLedger(item.runDir)).cleanupIncomplete).toBe(true)
    expect((await item.journal.getState()).reflected_completed_steps).toBe(1)
  }, 30_000)

  test("#given a failed run whose branch cannot be deleted #when the supervisor failure settles #then the failure is published without throwing", async () => {
    // given
    const item = await fixture(false)
    await pinRunBranch(item)
    await rm(join(item.runDir, "outcome.json"))

    // when
    const result = await failReservationRun({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger, "failed", "supervisor died")

    // then
    expect(result?.outcome).toBe("failed")
    expect(existsSync(join(item.runDir, "final.json"))).toBe(true)
    expect((await readLedger(item.runDir)).cleanupIncomplete).toBe(true)
  }, 30_000)
})
