import { afterEach, describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  GitMemoryRepo,
  cleanupReflectionWorktree,
} from "@oh-my-opencode/memory-core"

import { finalizeRecordedOutcome } from "./run-finalization"
import { writeRunJsonAtomic } from "./run-artifacts"
import {
  cleanupFinalizationFixtures,
  finalizationFixture as fixture,
  runReceiptCount as receiptCount,
} from "./run-finalization.test-support"
import type { ReservationRunLedger } from "./reservation-run-ledger"

afterEach(cleanupFinalizationFixtures)

describe("reflection finalization crash recovery", () => {
  test("#given integration landed before its checkpoint #when finalization retries #then receipt recovery settles exactly once", async () => {
    // given
    const item = await fixture()

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
      withWriterLock: async (operation) => operation(),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("merged")
    expect(await receiptCount(item.repo.dir)).toBe(1)
    expect((await item.journal.getState()).reflected_completed_steps).toBe(1)
    expect(JSON.parse(await readFile(join(item.runDir, "final.json"), "utf8"))).toMatchObject({
      outcome: "merged",
    })
  }, 30_000)

  test("#given merge cleanup and settlement completed before final publication #when retried #then completion and final repair without duplicate settlement", async () => {
    // given
    const item = await fixture()
    expect(await cleanupReflectionWorktree(item.worktree)).toEqual({
      worktreeRemoved: true,
      branchRemoved: true,
    })
    await item.store.complete(item.ledger.runId, "merged")

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("merged")
    expect(await receiptCount(item.repo.dir)).toBe(1)
    expect((await item.journal.getState()).reflected_completed_steps).toBe(1)
    expect(JSON.parse(await readFile(
      join(item.identity.paths.reflection, "completions", "run-1.json"),
      "utf8",
    ))).toMatchObject({ outcome: "merged" })
  }, 30_000)

  test("#given a pressure dream merges above its token target #when finalization validates committed system memory #then the merge records a budget_not_met warning", async () => {
    const item = await fixture(false)
    await writeFile(join(item.worktree.dir, "system", "learned.md"), `---\ndescription: Learned\n---\n${"L".repeat(400)}`)
    const childRepo = new GitMemoryRepo({ dir: item.worktree.dir, agentId: item.identity.id })
    await childRepo.commitWrite(["system/learned.md"], "dream retained too much", {
      agentId: item.identity.id,
      authorName: "Dream Agent",
    })
    const dreamLedger: ReservationRunLedger = {
      ...item.ledger,
      kind: "dream",
      trigger: "dream",
      origin: "pressure",
      systemTokenBudget: 100,
      systemTokenTarget: 80,
    }
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), dreamLedger)

    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
      withWriterLock: async (operation) => operation(),
    }, item.runDir, dreamLedger)

    expect(result).toMatchObject({
      outcome: "merged",
      reason: "budget_not_met",
      detail: "Committed system/ estimate is 116 tokens; pressure dream target is below 80 tokens",
    })
    expect(result?.completion).toMatchObject({ outcome: "merged", reason: "budget_not_met" })
  }, 30_000)

  test("#given parent_dirty was checkpointed before cleanup #when finalization retries #then the durable decision and user edit are preserved", async () => {
    // given
    const item = await fixture(false)
    await writeFile(join(item.repo.dir, "system", "base.md"), "---\ndescription: Base\n---\nuser edit\n")
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger,
      finalizePhase: "validated",
      validatedTipSha: item.validation.tipSha,
      validatedChangedPaths: item.validation.changedPaths,
      finalizeOutcome: "parent_dirty",
      finalizeReason: "parent_dirty",
      finalizeDetail: "parent has user changes",
    })
    await cleanupReflectionWorktree(item.worktree)

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("parent_dirty")
    expect(await readFile(join(item.repo.dir, "system", "base.md"), "utf8")).toContain("user edit")
    expect(result?.completion?.detail).toBe("parent has user changes")
  }, 30_000)
})
