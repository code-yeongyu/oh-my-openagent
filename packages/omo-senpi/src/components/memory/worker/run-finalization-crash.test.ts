import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  cleanupReflectionWorktree,
  createNodeGitExec,
  createReflectionWorktree,
  integrateValidatedReflection,
  validateCompletion,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import { finalizeRecordedOutcome } from "./run-finalization"
import { writeRunJsonAtomic } from "./run-artifacts"
import type { ReservationRunLedger } from "./reservation-run-ledger"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(integrate = true) {
  const root = await mkdtemp(join(tmpdir(), "run-finalization-crash-"))
  roots.push(root)
  const identity: MemoryIdentity = {
    id: "agent-test",
    safeSlug: "agent-test",
    paths: buildIdentityPaths(root, "agent-test"),
  }
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: [{ relativePath: "system/base.md", content: "---\ndescription: Base\n---\nbase\n" }] })
  const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, "conversation-a") })
  await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["remember"] }])
  const store = new ReflectionReservationStore({
    identity,
    config: { stepCount: 1, onCompaction: true },
    getJournal: async () => journal,
    createRunId: () => "run-1",
  })
  const snapshot = await journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected snapshot")
  const reserved = await store.tryReserve({
    trigger: "step-count",
    conversationIds: ["conversation-a"],
    snapshots: [{ conversationId: "conversation-a", snapshot }],
  })
  const worktree = await createReflectionWorktree(repo, reserved.run.runId, identity.paths.worktrees)
  await mkdir(join(worktree.dir, "system"), { recursive: true })
  await writeFile(join(worktree.dir, "system", "learned.md"), "---\ndescription: Learned\n---\nlearned\n")
  const childRepo = new GitMemoryRepo({ dir: worktree.dir, agentId: identity.id })
  await childRepo.commitWrite(["system/learned.md"], "reflection learned", {
    agentId: identity.id,
    authorName: "Reflection Agent",
  })
  const runDir = join(identity.paths.reflection, "runs", reserved.run.runId)
  await mkdir(runDir, { recursive: true })
  const ledger: ReservationRunLedger = {
    version: 1,
    runId: reserved.run.runId,
    attempt: 1,
    category: "quick",
    conversationIds: ["conversation-a"],
    model: "fixture/model",
    kind: "reflection",
    trigger: "step-count",
    startedAt: "2026-08-11T10:00:00.000Z",
    hardDeadlineAt: 1,
    terminationGraceMs: 1,
    deadlineAt: 2,
    mergePolicy: "auto",
    worktreeDir: worktree.dir,
    worktreeBranch: worktree.branch,
    baseSha: worktree.baseSha,
    gitFilePath: worktree.gitFilePath,
    gitFileSnapshot: worktree.gitFileSnapshot,
    commonConfigPath: worktree.commonConfigPath,
    commonConfigSnapshot: worktree.commonConfigSnapshot,
  }
  await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger)
  await writeRunJsonAtomic(join(runDir, "outcome.json"), {
    version: 1,
    runId: reserved.run.runId,
    attempt: 1,
    finishedAt: "2026-08-11T10:00:30.000Z",
    childExit: { code: 0, signal: null },
    timedOut: false,
  })
  const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
  if (validation.status !== "valid") throw new Error(`expected valid worktree: ${validation.status}`)
  if (integrate) {
    const integrated = await integrateValidatedReflection(worktree, {
      mode: "auto",
      runId: reserved.run.runId,
      summary: "step-count run-1",
      validated: { tipSha: validation.tipSha, changedPaths: validation.changedPaths },
      withWriterLock: async (operation) => operation(),
    })
    expect(integrated.outcome).toBe("merged")
  }
  return { identity, repo, journal, store, worktree, runDir, ledger, validation }
}

async function receiptCount(repoDir: string): Promise<number> {
  const log = await createNodeGitExec().run(["log", "--format=%B%x00"], {
    cwd: repoDir,
    timeoutMs: 30_000,
  })
  return log.stdout.split("\0").filter((body) => body.includes("Omo-Run: run-1")).length
}

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
    await writeFile(join(item.worktree.dir, "system", "learned.md"), "L".repeat(400))
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
      detail: "Committed system/ estimate is 108 tokens; pressure dream target is below 80 tokens",
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
