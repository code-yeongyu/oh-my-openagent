import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  createNodeGitExec,
  createReflectionWorktree,
  integrateValidatedReflection,
  validateCompletion,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import { writeRunJsonAtomic } from "./run-artifacts"
import type { ReservationRunLedger } from "./reservation-run-ledger"

const roots: string[] = []

export async function cleanupFinalizationFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}

/** A settled reflection run: committed worktree, published outcome, and (by default) a landed merge. */
export async function finalizationFixture(integrate = true) {
  const root = await mkdtemp(join(tmpdir(), "run-finalization-"))
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
  if (reserved.status === "parked") throw new Error("fixture reservation was parked")
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
    if (integrated.outcome !== "merged") throw new Error(`expected a landed merge: ${integrated.outcome}`)
  }
  return { root, identity, repo, journal, store, worktree, runDir, ledger, validation }
}

export async function runReceiptCount(repoDir: string): Promise<number> {
  const log = await createNodeGitExec().run(["log", "--format=%B%x00"], { cwd: repoDir, timeoutMs: 30_000 })
  return log.stdout.split("\0").filter((body) => body.includes("Omo-Run: run-1")).length
}
