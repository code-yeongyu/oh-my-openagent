import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync, readdirSync, realpathSync } from "node:fs"

import {
  GitMemoryRepo,
  LockContentionError,
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  createReflectionWorktree,
  type LockRecord,
  type MemoryIdentity,
  type ReflectionLauncherIdentity,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"

import type { ReservationStatePort } from "./run-finalization"
import { writeRunJsonAtomic } from "./run-artifacts"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
export const PHASE_IDLE_MS = process.platform === "win32" ? 10_000 : 2_000
const GIT_PROCESS_ENDED = /"event":"(?:exit|atexit|signal)"/
/** trace2 names each event file after the process's session id, whose last field is `P<pid in hex>`. */
const TRACE_FILE_PID = /-P([0-9a-f]+)$/i
let gitTrace: { readonly dir: string; readonly previous: string | undefined; depth: number } | undefined

export async function cleanupReconciliationFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) =>
    rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  ))
}

export async function reconciliationFixture(
  trigger: "step-count" | "dream" = "step-count",
  launcherIdentity: () => Promise<ReflectionLauncherIdentity> = async () => ({ pid: 111, hostname: "fixture-host", processStart: "launcher-start" }),
) {
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
    launcherIdentity,
  })
  const snapshot = await journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected snapshot")
  const reserved = await store.tryReserve({
    trigger,
    ...(trigger === "dream" ? { origin: "shutdown" as const } : {}),
    conversationIds: ["conversation-a"],
    snapshots: [{ conversationId: "conversation-a", snapshot }],
  })
  if (reserved.status === "parked") throw new Error("fixture reservation was parked")
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

/**
 * Retires the fixture's run directory with the selected terminal artifact and its real schema.
 * Only final.json settles the ledger. The reservation that currently holds the
 * same run id is untouched, so a `finishedAt` before its `reservedAt` reproduces the shadowing
 * shape from issue #7912.
 */
export async function retireRunGeneration(
  item: Awaited<ReturnType<typeof reconciliationFixture>>,
  finishedAt: string,
  terminal: "final" | "abandoned" = "final",
): Promise<void> {
  await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
    ...item.ledger,
    startedAt: new Date(Date.parse(finishedAt) - 1_000).toISOString(),
    ...(terminal === "final" ? {
      finalizePhase: "settled",
      finalizeOutcome: "merged",
      finalizedAt: finishedAt,
    } : {}),
  })
  await writeRunJsonAtomic(join(item.runDir, `${terminal}.json`), {
    version: 1,
    runId: item.ledger.runId,
    ...(terminal === "final"
      ? { outcome: "merged", finishedAt }
      : { outcome: "abandoned_unknown", abandonedAt: finishedAt }),
  })
}

/** Queues a second request so a reclaimed reservation has something to promote. */
export async function queuePendingReservation(
  item: Awaited<ReturnType<typeof reconciliationFixture>>,
): Promise<void> {
  const pending: ReservedRun = {
    runId: "run-pending",
    request: { trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] },
  }
  await writeFile(
    join(item.identity.paths.reflection, "pending.json"),
    `${JSON.stringify(pending, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
}

export async function commitOrphanWorktree(
  item: Awaited<ReturnType<typeof reconciliationFixture>>,
): Promise<void> {
  await mkdir(join(item.worktree.dir, "system"), { recursive: true })
  await writeFile(join(item.worktree.dir, "system", "orphan.md"), "---\ndescription: Orphan\n---\nrecovered\n")
  await item.worktree.exec.run(["add", "system/orphan.md"], { cwd: item.worktree.dir, timeoutMs: 30_000 })
  await item.worktree.exec.run(["commit", "-m", "reflection orphan"], { cwd: item.worktree.dir, timeoutMs: 30_000 })
}

/**
 * Fails a phase that stops making progress, never one that is merely slow (#11984).
 *
 * A reconciliation pass does its real work in git processes. While a phase runs, every git process
 * reports its own start and end through trace2 (`GIT_TRACE2_EVENT` names a directory, one event file
 * per process), and the watchdog fires only after PHASE_IDLE_MS in which no git process was in
 * flight and none started. A loaded host that slows git down therefore never trips it, while a pass
 * parked on a wait or on a promise that never settles still fails with the phase's name.
 *
 * The trace opens synchronously in the call itself, before `operation` runs, so a git process
 * started by the operation, or by the caller right after this call returns, is always traced.
 * Work a caller starts BEFORE calling withinPhase is not covered: start it inside the operation.
 */
export async function withinPhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  const traceDir = openGitTrace()
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let seen = readdirSync(traceDir).length
    const stalled = new Promise<never>((_, reject) => {
      const check = async (): Promise<void> => {
        const activity = await gitActivity(traceDir)
        if (settled) return
        if (activity.running > 0 || activity.started !== seen) {
          seen = activity.started
          schedule()
          return
        }
        reject(new Error(
          `${phase} stalled: no git progress for ${PHASE_IDLE_MS} ms (${Math.round(performance.now() - startedAt)} ms elapsed)`,
        ))
      }
      // A check that throws (the trace directory removed under it) fails the phase, never the process.
      const schedule = (): void => {
        timer = setTimeout(() => {
          check().catch((error: unknown) => {
            if (!settled) reject(error)
          })
        }, PHASE_IDLE_MS)
      }
      schedule()
    })
    return await Promise.race([operation(), stalled])
  } finally {
    settled = true
    if (timer !== undefined) clearTimeout(timer)
    closeGitTrace()
  }
}

/** Nested phases share one trace directory, so an outer phase sees the git work of an inner one. */
function openGitTrace(): string {
  if (gitTrace === undefined) {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "reflection-reconcile-trace-")))
    roots.push(dir)
    gitTrace = { dir, previous: process.env.GIT_TRACE2_EVENT, depth: 0 }
    process.env.GIT_TRACE2_EVENT = dir
  }
  gitTrace.depth += 1
  return gitTrace.dir
}

function closeGitTrace(): void {
  if (gitTrace === undefined) return
  gitTrace.depth -= 1
  if (gitTrace.depth > 0) return
  if (gitTrace.previous === undefined) delete process.env.GIT_TRACE2_EVENT
  else process.env.GIT_TRACE2_EVENT = gitTrace.previous
  gitTrace = undefined
}

/**
 * A git process is in flight from its first trace event until it records how it ended, or until it
 * is gone: a SIGKILLed git never writes its end, so its pid (from the trace file name) is probed.
 * The age of the last write cannot stand in for that: a slow git waiting on a child writes nothing.
 */
async function gitActivity(dir: string): Promise<{ readonly started: number; readonly running: number }> {
  const names = await readdir(dir)
  const events = await Promise.all(names.map(async (name) => ({ name, text: await readFile(join(dir, name), "utf8") })))
  const running = events.filter(({ name, text }) => !GIT_PROCESS_ENDED.test(text) && gitProcessAlive(name))
  return { started: names.length, running: running.length }
}

function gitProcessAlive(traceFile: string): boolean {
  const hex = TRACE_FILE_PID.exec(traceFile)?.[1]
  if (hex === undefined) return true
  try {
    process.kill(Number.parseInt(hex, 16), 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
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
