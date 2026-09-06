import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"

import {
  GitMemoryRepo,
  LockContentionError,
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  createReflectionWorktree,
  type LockRecord,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import type { ReservationStatePort } from "./run-finalization"
import { writeRunJsonAtomic } from "./run-artifacts"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
const PHASE_WATCHDOG_MS = 2_000

export async function cleanupReconciliationFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) =>
    rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  ))
}

export async function reconciliationFixture(trigger: "step-count" | "dream" = "step-count") {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-reconcile-")))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: [{ relativePath: "system/base.md", content: "---\ndescription: Base\n---\nbase\n" }] })
  const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, "conversation-a") })
  await journal.reconcile([
    { kind: "user", messageId: "user-1", text: "remember" },
    { kind: "assistant", messageId: "assistant-1", textBlocks: ["noted"] },
  ])
  const store = new ReflectionReservationStore({
    identity,
    config: { stepCount: 1, onCompaction: true },
    getJournal: async () => journal,
    createRunId: () => "run-orphan",
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    launcherIdentity: async () => ({ pid: 111, hostname: "fixture-host", processStart: "launcher-start" }),
  })
  const snapshot = await journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected snapshot")
  const reserved = await store.tryReserve({
    trigger,
    ...(trigger === "dream" ? { origin: "shutdown" as const } : {}),
    conversationIds: ["conversation-a"],
    snapshots: [{ conversationId: "conversation-a", snapshot }],
  })
  const worktree = await createReflectionWorktree(repo, reserved.run.runId, identity.paths.worktrees)
  const runDir = join(identity.paths.reflection, "runs", reserved.run.runId)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeRunJsonAtomic(join(runDir, "prelaunch.json"), {
    version: 1,
    runId: reserved.run.runId,
    worktreeDir: worktree.dir,
    worktreeBranch: worktree.branch,
  })
  const ledger = {
    version: 1 as const,
    runId: reserved.run.runId,
    category: "quick",
    conversationIds: ["conversation-a"],
    kind: trigger === "dream" ? "dream" as const : "reflection" as const,
    trigger,
    ...(trigger === "dream" ? { origin: "shutdown" as const } : {}),
    startedAt: "2026-08-10T00:00:00.000Z",
    hardDeadlineAt: 1_000,
    terminationGraceMs: 100,
    deadlineAt: 1_100,
    mergePolicy: "auto" as const,
    worktreeDir: worktree.dir,
    worktreeBranch: worktree.branch,
    baseSha: worktree.baseSha,
    gitFilePath: worktree.gitFilePath,
    gitFileSnapshot: worktree.gitFileSnapshot,
    commonConfigPath: worktree.commonConfigPath,
    commonConfigSnapshot: worktree.commonConfigSnapshot,
  }
  await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger)
  return { identity, repo, journal, store, worktree, runDir, ledger }
}

export async function commitOrphanWorktree(
  item: Awaited<ReturnType<typeof reconciliationFixture>>,
): Promise<void> {
  await mkdir(join(item.worktree.dir, "system"), { recursive: true })
  await writeFile(join(item.worktree.dir, "system", "orphan.md"), "---\ndescription: Orphan\n---\nrecovered\n")
  await item.worktree.exec.run(["add", "system/orphan.md"], { cwd: item.worktree.dir, timeoutMs: 30_000 })
  await item.worktree.exec.run(["commit", "-m", "reflection orphan"], { cwd: item.worktree.dir, timeoutMs: 30_000 })
}

export async function withinPhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${phase} stalled after ${Math.round(performance.now() - startedAt)} ms`))
    }, PHASE_WATCHDOG_MS)
  })
  try {
    return await Promise.race([operation(), stalled])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function contendedReservation(lockPath: string, owner: LockRecord | null): ReservationStatePort {
  return {
    readState: async (options?: { readonly waitTimeoutMs?: number }) => {
      if (options?.waitTimeoutMs !== 0) {
        throw new Error("scheduler contention must use an immediate lock attempt")
      }
      throw new LockContentionError(lockPath, owner)
    },
    complete: async () => {
      throw new Error("reservation mutated during scheduler contention")
    },
  }
}
