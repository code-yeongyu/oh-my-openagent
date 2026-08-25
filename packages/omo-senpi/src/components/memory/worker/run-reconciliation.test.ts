import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  createReflectionWorktree,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"
import { existsSync, realpathSync } from "node:fs"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

async function fixture(trigger: "step-count" | "dream" = "step-count") {
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

async function commitOrphanWorktree(item: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await mkdir(join(item.worktree.dir, "system"), { recursive: true })
  await writeFile(join(item.worktree.dir, "system", "orphan.md"), "---\ndescription: Orphan\n---\nrecovered\n")
  await item.worktree.exec.run(["add", "system/orphan.md"], { cwd: item.worktree.dir, timeoutMs: 30_000 })
  await item.worktree.exec.run(["commit", "-m", "reflection orphan"], { cwd: item.worktree.dir, timeoutMs: 30_000 })
}

describe("reflection and dream run reconciliation", () => {
  test("#given an orphaned successful dream worktree #when session-start reconciliation runs #then it merges clears the reservation records completion and publishes final", async () => {
    // given
    const item = await fixture("dream")
    await commitOrphanWorktree(item)
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger,
      attempt: 2,
      model: "omo-mock/mock-1",
      thinking: "minimal",
    })
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1, runId: "run-orphan", finishedAt: "2026-08-10T00:00:01.000Z",
      attempt: 2, childExit: { code: 0, signal: null }, timedOut: false,
    })

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "merged" }])
    expect(await readFile(join(item.identity.paths.repo, "system", "orphan.md"), "utf8")).toContain("recovered")
    expect((await item.store.readState()).active).toBeUndefined()
    expect((await item.journal.getState()).reflected_completed_steps).toBe(1)
    expect(JSON.parse(await readFile(join(item.identity.paths.reflection, "completions", "run-orphan.json"), "utf8"))).toMatchObject({
      runId: "run-orphan", trigger: "dream", origin: "shutdown", outcome: "merged",
      model: "omo-mock/mock-1", thinking: "minimal",
    })
    expect(JSON.parse(await readFile(join(item.runDir, "final.json"), "utf8"))).toMatchObject({
      version: 1, runId: "run-orphan", outcome: "merged",
    })
  }, 30_000)

  test("#given attempt two is live with a stale attempt-one outcome #when reconciled #then the retry remains active and its worktree stays intact", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger,
      attempt: 2,
      model: "omo-mock/mock-1",
      pid: 222,
      processStart: "supervisor-two",
      childPid: 333,
      childProcessStart: "child-two",
    })
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1,
      runId: "run-orphan",
      attempt: 1,
      finishedAt: "2026-08-10T00:00:01.000Z",
      childExit: { code: 1, signal: null },
      timedOut: false,
    })

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      getPidLiveness: () => "alive",
      getProcessStartIdentity: async (pid) => pid === 222 ? "supervisor-two" : "child-two",
    })

    // then
    expect(results).toEqual([])
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
    expect(Bun.file(item.worktree.dir).size).toBeGreaterThan(0)
  }, 30_000)

  test("#given attempt two is being launched with a stale attempt-one outcome #when reconciled before the shared deadline #then the retry remains active", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger,
      attempt: 2,
      model: "omo-mock/mock-1",
      launching: true,
    })
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1,
      runId: "run-orphan",
      attempt: 1,
      finishedAt: "2026-08-10T00:00:01.000Z",
      childExit: { code: 1, signal: null },
      timedOut: false,
    })

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      now: () => 500,
    })

    // then
    expect(results).toEqual([])
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
  }, 30_000)

  test("#given a failed child outcome with a valid commit #when reconciled #then output is never merged and the cursor remains retryable", async () => {
    // given
    const item = await fixture()
    await commitOrphanWorktree(item)
    await writeFile(join(item.runDir, "child-stderr.log"), "model child failed validation\n")
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1, runId: "run-orphan", finishedAt: "2026-08-10T00:00:01.000Z",
      childExit: { code: 7, signal: null }, timedOut: false,
    })

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect(Bun.file(join(item.identity.paths.repo, "system", "orphan.md")).size).toBe(0)
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
    const completion = JSON.parse(await readFile(join(item.identity.paths.reflection, "completions", "run-orphan.json"), "utf8"))
    expect(completion.detail).toContain("model child failed validation")
  }, 30_000)

  test("#given genuinely gone processes with unknown liveness and no outcome #when the bounded watch expires #then the run is abandoned without cleanup or cursor advance", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger, pid: 222, processStart: null, childPid: 333, childProcessStart: null,
    })

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      now: () => 2_000,
      waitForOutcome: async () => "timeout",
      getPidLiveness: () => "unknown",
      getProcessStartIdentity: async () => null,
    })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "abandoned_unknown" }])
    expect(JSON.parse(await readFile(join(item.runDir, "abandoned.json"), "utf8"))).toMatchObject({
      version: 1, runId: "run-orphan", outcome: "abandoned_unknown",
    })
    expect(Bun.file(join(item.runDir, "final.json")).size).toBe(0)
    expect(Bun.file(item.worktree.dir).size).not.toBe(0)
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
  }, 30_000)

  test("#given a dead identified supervisor and live identified child #when the shared deadline elapses #then reconciliation signals on the persisted timeline and cleans only after confirmed death", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger, pid: 222, processStart: "supervisor-start", childPid: 333, childProcessStart: "child-start",
    })
    let childAlive = true
    const signals: Array<{ pid: number; signal: NodeJS.Signals; at: number }> = []
    let now = 900

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      now: () => now,
      getPidLiveness: (pid) => pid === 222 ? "dead" : childAlive ? "alive" : "dead",
      getProcessStartIdentity: async (pid) => pid === 333 ? "child-start" : null,
      waitUntil: async (deadlineAt) => { now = deadlineAt },
      signalProcessGroup: (pid, signal) => {
        signals.push({ pid, signal, at: now })
        if (signal === "SIGKILL") childAlive = false
      },
    })

    // then
    expect(signals).toEqual([
      { pid: 333, signal: "SIGTERM", at: 1_000 },
      { pid: 333, signal: "SIGKILL", at: 1_100 },
    ])
    expect(results).toEqual([{ runId: "run-orphan", outcome: "timed_out" }])
    expect(Bun.file(item.worktree.dir).size).toBe(0)
  }, 30_000)

  test("#given old pre-launch reservations with unverifiable or reused launcher pids #when reconciled #then only confirmed pid reuse releases the reservation", async () => {
    // given
    const unknown = await fixture()
    await rmEfaultTolerant(unknown.runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })

    // when
    const untouched = await reconcileReflectionRuns({
      identity: unknown.identity,
      reservation: unknown.store,
      hostname: () => "fixture-host",
      now: () => Date.parse("2026-08-10T00:01:01.001Z"),
      getPidLiveness: () => "alive",
      getProcessStartIdentity: async () => null,
    })
    const reused = await reconcileReflectionRuns({
      identity: unknown.identity,
      reservation: unknown.store,
      hostname: () => "fixture-host",
      now: () => Date.parse("2026-08-10T00:01:01.001Z"),
      getPidLiveness: () => "alive",
      getProcessStartIdentity: async () => "different-start",
    })

    // then
    expect(untouched).toEqual([])
    expect(reused).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect((await unknown.journal.getState()).reflected_completed_steps).toBe(0)
  }, 30_000)

  test("#given an old prelaunch worktree without a ledger and a confirmed-dead launcher #when reconciled #then resources and reservation are released", async () => {
    // given
    const item = await fixture()
    await rm(join(item.runDir, "ledger.json"))

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      hostname: () => "fixture-host",
      now: () => Date.parse("2026-08-10T00:01:01.001Z"),
      getPidLiveness: () => "dead",
    })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect((await item.store.readState()).active).toBeUndefined()
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
    expect(existsSync(item.worktree.dir)).toBe(false)
    expect(existsSync(item.runDir)).toBe(false)
    expect((await item.worktree.exec.run(
      ["show-ref", "--verify", `refs/heads/${item.worktree.branch}`],
      { cwd: item.repo.dir, timeoutMs: 30_000 },
    )).code).not.toBe(0)
  }, 30_000)
})
