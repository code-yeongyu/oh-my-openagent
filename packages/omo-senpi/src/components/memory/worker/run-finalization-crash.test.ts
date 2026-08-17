import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
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

  test("#given a terminal sentinel from an earlier run still holding the reservation #when finalization short-circuits #then the reservation is released instead of stranding the lock", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "final.json"), {
      version: 1,
      runId: item.ledger.runId,
      outcome: "merged",
      finishedAt: "2026-08-08T22:46:46.812Z",
    })
    expect((await item.store.readState()).active?.runId).toBe(item.ledger.runId)

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("merged")
    expect((await item.store.readState()).active).toBeUndefined()
  }, 30_000)

  test("#given a child that died on a provider usage limit inside a run directory an earlier run had settled #when finalization runs #then the lock is released a failed completion carries the provider error and the worktree is pruned", async () => {
    // given
    const item = await fixture(false)
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1,
      runId: item.ledger.runId,
      attempt: 1,
      finishedAt: "2026-08-11T10:00:30.000Z",
      childExit: { code: 1, signal: null },
      timedOut: false,
    })
    await writeFile(join(item.runDir, "child-stderr.log"), "Codex error: The usage limit has been reached\n")
    // The colliding run id let an older run's success sentinel survive into this run's directory,
    // which is what made the failure invisible and stranded the lock on the live machine.
    await writeRunJsonAtomic(join(item.runDir, "final.json"), {
      version: 1,
      runId: item.ledger.runId,
      outcome: "merged",
      finishedAt: "2026-08-08T22:46:46.812Z",
    })

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("failed")
    expect(result?.reason).toBe("child_exit")
    expect(result?.detail).toBe("Codex error: The usage limit has been reached")
    expect((await item.store.readState()).active).toBeUndefined()
    expect(JSON.parse(await readFile(
      join(item.identity.paths.reflection, "completions", "run-1.json"),
      "utf8",
    ))).toMatchObject({ outcome: "failed", detail: "Codex error: The usage limit has been reached" })
    expect(existsSync(item.worktree.dir)).toBe(false)
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
  }, 30_000)

  test("#given a settled run #when it publishes its final sentinel #then the spawn payload is not retained alongside the result", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "transcript-payload.json"), {
      request: { conversationIds: ["conversation-a"] },
    })

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
      withWriterLock: async (operation) => operation(),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("merged")
    expect(existsSync(join(item.runDir, "transcript-payload.json"))).toBe(false)
    expect(existsSync(join(item.runDir, "final.json"))).toBe(true)
  }, 30_000)

  test("#given a terminal sentinel naming a different run #when finalization runs #then the reservation is still released instead of stranded", async () => {
    // given
    const item = await fixture(false)
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1,
      runId: item.ledger.runId,
      attempt: 1,
      finishedAt: "2026-08-11T10:00:30.000Z",
      childExit: { code: 1, signal: null },
      timedOut: false,
    })
    await writeRunJsonAtomic(join(item.runDir, "final.json"), {
      version: 1,
      runId: "a-different-run",
      outcome: "merged",
      finishedAt: "2026-08-08T22:46:46.812Z",
    })

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("failed")
    expect((await item.store.readState()).active).toBeUndefined()
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
  }, 30_000)

  test("#given a child that died on a provider usage limit #when finalization runs #then a failed completion carries the provider error and the worktree is pruned", async () => {
    // given
    const item = await fixture(false)
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1,
      runId: item.ledger.runId,
      attempt: 1,
      finishedAt: "2026-08-11T10:00:30.000Z",
      childExit: { code: 1, signal: null },
      timedOut: false,
    })
    await writeFile(join(item.runDir, "child-stderr.log"), "Codex error: The usage limit has been reached\n")

    // when
    const result = await finalizeRecordedOutcome({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("failed")
    expect(result?.reason).toBe("child_exit")
    expect(result?.detail).toBe("Codex error: The usage limit has been reached")
    expect((await item.store.readState()).active).toBeUndefined()
    expect(JSON.parse(await readFile(
      join(item.identity.paths.reflection, "completions", "run-1.json"),
      "utf8",
    ))).toMatchObject({ outcome: "failed", detail: "Codex error: The usage limit has been reached" })
    expect(existsSync(item.worktree.dir)).toBe(false)
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
