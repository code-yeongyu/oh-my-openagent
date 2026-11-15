import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import { createReflectionWorktree, getPidLiveness } from "@oh-my-opencode/memory-core"

import { writeRunJsonAtomic } from "./worker/run-artifacts"
import {
  activeRunId,
  cleanupStaleLockFixtures,
  deadPid,
  settleTurn,
  staleLockFixture,
} from "./wiring-reflection-stale-lock.test-support"

afterEach(cleanupStaleLockFixtures)

type Fixture = Awaited<ReturnType<typeof staleLockFixture>>

async function reserve(item: Fixture): Promise<string> {
  const snapshot = await item.journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected a snapshot")
  const reserved = await item.store.tryReserve({
    trigger: "manual",
    conversationIds: ["session-1"],
    snapshots: [{ conversationId: "session-1", snapshot }],
  })
  if (reserved.status !== "active") throw new Error(`expected an active reservation, got ${reserved.status}`)
  return reserved.run.runId
}

async function launcherDied(item: Fixture, pid: number): Promise<void> {
  const activePath = join(item.paths.reflection, "active.lock")
  const active = JSON.parse(await readFile(activePath, "utf8")) as Record<string, unknown>
  await writeFile(
    activePath,
    JSON.stringify({
      ...active,
      launcherPid: pid,
      launcherHostname: hostname(),
      launcherProcessStart: null,
      reservedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }),
    { mode: 0o600 },
  )
}

async function launchInterrupted(item: Fixture): Promise<string> {
  const runId = await reserve(item)
  await launcherDied(item, await deadPid())
  return runId
}

async function processesDied(item: Fixture): Promise<string> {
  const runId = await reserve(item)
  const pid = await deadPid()
  const worktree = await createReflectionWorktree(item.repo, runId, item.paths.worktrees)
  const runDir = join(item.paths.reflection, "runs", runId)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeRunJsonAtomic(join(runDir, "prelaunch.json"), {
    version: 1,
    runId,
    worktreeDir: worktree.dir,
    worktreeBranch: worktree.branch,
  })
  const hardDeadlineAt = Date.now() + 600_000
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId,
    attempt: 1,
    category: "quick",
    conversationIds: ["session-1"],
    kind: "reflection",
    trigger: "manual",
    startedAt: new Date().toISOString(),
    hardDeadlineAt,
    terminationGraceMs: 100,
    deadlineAt: hardDeadlineAt + 100,
    mergePolicy: "auto",
    pid,
    processStart: null,
    childPid: pid,
    childProcessStart: null,
    worktreeDir: worktree.dir,
    worktreeBranch: worktree.branch,
    baseSha: worktree.baseSha,
    gitFilePath: worktree.gitFilePath,
    gitFileSnapshot: worktree.gitFileSnapshot,
    commonConfigPath: worktree.commonConfigPath,
    commonConfigSnapshot: worktree.commonConfigSnapshot,
  })
  await launcherDied(item, pid)
  return runId
}

async function runDoctorFix(item: Fixture): Promise<string> {
  const command = item.pi.commands.find((entry) => entry.name === "doctor")
  if (command === undefined) throw new Error("doctor command not registered")
  const handler = command.options.handler as (args: string, ctx: unknown) => Promise<string>
  return handler("--fix", item.eventCtx)
}

// A sibling run outside the reservation whose supervisor is live and whose deadline is ten minutes out.
async function liveSibling(item: Fixture, pid: number): Promise<string> {
  const runId = "reflection-run-40"
  const hardDeadlineAt = Date.now() + 600_000
  const runDir = join(item.paths.reflection, "runs", runId)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId,
    attempt: 1,
    kind: "reflection",
    trigger: "manual",
    startedAt: new Date().toISOString(),
    hardDeadlineAt,
    terminationGraceMs: 100,
    deadlineAt: hardDeadlineAt + 100,
    mergePolicy: "auto",
    pid,
    processStart: null,
    worktreeDir: "/nonexistent/worktree",
    worktreeBranch: `reflection/${runId}`,
    baseSha: "0".repeat(40),
    gitFilePath: "/nonexistent/worktree/.git",
    gitFileSnapshot: "gitdir: /nonexistent",
    commonConfigPath: "/nonexistent/config",
    commonConfigSnapshot: null,
  })
  return runId
}

function staleNotices(item: Fixture): string[] {
  return item.eventCtx.notices.filter((notice) => notice.message.includes("stale lock")).map((notice) => notice.message)
}

describe("the stale reflection-lock reaper in a session (#11976)", () => {
  test("#given case A before the session's first settle #when session start reconciles #then the lock is released with abandoned.json(launch_interrupted)", async () => {
    // given
    const item = await staleLockFixture()
    const runId = await launchInterrupted(item)

    // when
    await settleTurn(item)

    // then
    expect(await activeRunId(item)).not.toBe(runId)
    expect(
      JSON.parse(await readFile(join(item.paths.reflection, "runs", runId, "abandoned.json"), "utf8")),
    ).toMatchObject({ reason: "launch_interrupted" })
  }, 30_000)

  test("#given case A after the session already reconciled #when the next turn settles #then it is reaped once, without a stale-lock notice", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    const runId = await launchInterrupted(item)
    const before = item.reconciles.count

    // when
    await settleTurn(item)
    await settleTurn(item)

    // then
    expect(item.reconciles.count).toBe(before + 1)
    expect(await activeRunId(item)).not.toBe(runId)
    expect(
      JSON.parse(await readFile(join(item.paths.reflection, "runs", runId, "abandoned.json"), "utf8")),
    ).toMatchObject({ reason: "launch_interrupted" })
    expect(staleNotices(item)).toEqual([])
  }, 30_000)

  test("#given case B after the session already reconciled #when the next turn settles #then reconciliation fails the run and releases the lock", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    const runId = await processesDied(item)

    // when
    await settleTurn(item)

    // then
    expect(await activeRunId(item)).not.toBe(runId)
    expect(JSON.parse(await readFile(join(item.paths.reflection, "runs", runId, "final.json"), "utf8"))).toMatchObject({
      outcome: "failed",
    })
    expect(staleNotices(item)).toEqual([])
  }, 30_000)

  test("#given case E: a torn active.lock after the session reconciled #when the next turn settles #then it is moved aside and no stale-lock notice is shown", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    await mkdir(item.paths.reflection, { recursive: true })
    await writeFile(join(item.paths.reflection, "active.lock"), '{"runId":"reflection-run-64","req', { mode: 0o600 })
    const old = new Date(Date.now() - 2 * 60 * 60_000)
    await utimes(join(item.paths.reflection, "active.lock"), old, old)

    // when
    await settleTurn(item)

    // then
    expect(existsSync(join(item.paths.reflection, "active.lock"))).toBe(false)
    expect(readdirSync(item.paths.reflection).filter((name) => name.startsWith("active.lock.torn-"))).toHaveLength(1)
    expect(await activeRunId(item)).toBeUndefined()
    expect(staleNotices(item)).toEqual([])
  }, 30_000)

  test("#given case A beside a sibling run whose supervisor is live #when /doctor --fix runs #then the lock is reaped without waiting on the sibling's deadline", async () => {
    // given
    const SIBLING_SUPERVISOR = 2_147_000_001
    const waits: string[] = []
    const item = await staleLockFixture(undefined, {
      reconcileSeams: {
        getPidLiveness: (pid) => (pid === SIBLING_SUPERVISOR ? "alive" : getPidLiveness(pid)),
        waitForOutcome: async (path) => {
          waits.push(path)
          return "timeout"
        },
      },
    })
    const runId = await launchInterrupted(item)
    const sibling = await liveSibling(item, SIBLING_SUPERVISOR)

    // when
    const reply = await runDoctorFix(item)

    // then
    expect(waits).toEqual([])
    expect(reply).toContain(`FIXED agent-test active.lock run ${runId} (launch-interrupted)`)
    expect(await activeRunId(item)).not.toBe(runId)
    expect(existsSync(join(item.paths.reflection, "runs", sibling, "abandoned.json"))).toBe(false)
  }, 30_000)

  test("#given case B whose first settle throws #when later turns settle #then the throw is not memoized and the next turn settles the run (#10395 item 2)", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    const runId = await processesDied(item)
    const before = item.reconciles.count
    item.reconciles.onStart = (pass) => {
      if (pass === before + 1) throw new Error("transient reconcile failure")
    }

    // when
    await settleTurn(item)
    const afterThrow = await activeRunId(item)
    await settleTurn(item)

    // then
    expect(afterThrow).toBe(runId)
    expect(item.reconciles.count).toBe(before + 2)
    expect(await activeRunId(item)).not.toBe(runId)
  }, 30_000)
})
