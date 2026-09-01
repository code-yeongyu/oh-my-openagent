import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  buildIdentityPaths,
  createReflectionWorktree,
  type MemoryIdentity,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"

import { abandonReservationRun } from "./run-finalization"
import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"
import { waitForFilesystemState } from "./supervisor-test-signals"

const supervisorPath = join(import.meta.dir, "../../../../plugin/extensions/memory-run-supervisor.mjs")
const childPath = join(import.meta.dir, "__fixtures__", "supervisor-finished-child.ts")
const roots: string[] = []
const supervisors = new Set<ChildProcess>()

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "run-terminal-precedence-")))
  roots.push(root)
  const identity: MemoryIdentity = {
    id: "agent-test",
    safeSlug: "agent-test",
    paths: buildIdentityPaths(root, "agent-test"),
  }
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: [{ relativePath: "system/base.md", content: "---\ndescription: Base\n---\nbase\n" }] })
  const worktree = await createReflectionWorktree(repo, "run-1", identity.paths.worktrees)
  const runDir = join(identity.paths.reflection, "runs", "run-1")
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const deadline = Date.now() + 30_000
  const ledger = {
    version: 1 as const,
    runId: "run-1",
    attempt: 1,
    category: "quick",
    conversationIds: ["conversation-a"],
    kind: "reflection" as const,
    trigger: "step-count" as const,
    startedAt: new Date().toISOString(),
    hardDeadlineAt: deadline,
    terminationGraceMs: 1_000,
    deadlineAt: deadline + 1_000,
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
  await writeRunJsonAtomic(join(runDir, "launch.json"), {
    version: 1,
    runId: "run-1",
    attempt: 1,
    kind: "reflection",
    command: process.execPath,
    args: [childPath, runDir],
    cwd: worktree.dir,
    env: { ...process.env },
    hardDeadlineAt: deadline,
    terminationGraceMs: 1_000,
    maxOutputBytes: 65_536,
    stdoutPath: join(runDir, "child-stdout.log"),
    stderrPath: join(runDir, "child-stderr.log"),
  })
  const active: ReservedRun = {
    runId: "run-1",
    request: { trigger: "step-count", conversationIds: ["conversation-a"], snapshots: [] },
  }
  return { identity, runDir, ledger, active }
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolve()
      else reject(new Error(`supervisor exited with code ${code} signal ${signal}`))
    })
  })
}

afterEach(async () => {
  for (const supervisor of supervisors) supervisor.kill("SIGKILL")
  supervisors.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("run terminal precedence", () => {
  test("#given abandonment owns the gate when the shipped supervisor child finishes successfully #when publication follows #then the matching outcome wins", async () => {
    const item = await fixture()
    let releaseStateRead!: () => void
    const stateReadRelease = new Promise<void>((resolve) => { releaseStateRead = resolve })
    let stateReadReached!: () => void
    const reachedStateRead = new Promise<void>((resolve) => { stateReadReached = resolve })
    let completedAsFailed = false
    const reservation = {
      readState: async () => {
        stateReadReached()
        await stateReadRelease
        return { active: item.active }
      },
      complete: async (_runId: string, outcome: "failed" | "timed_out") => {
        completedAsFailed = outcome === "failed"
        return { outcome }
      },
    }
    const abandonment = abandonReservationRun({
      identity: item.identity,
      reservation,
      now: Date.now,
    }, item.runDir, item.ledger)
    await reachedStateRead

    const supervisor = spawn(process.execPath, [supervisorPath, item.runDir], {
      detached: true,
      stdio: "ignore",
    })
    supervisors.add(supervisor)
    const supervisorExit = waitForExit(supervisor)
    await waitForFilesystemState(
      item.runDir,
      () => existsSync(join(item.runDir, "publishing.json")) ? true : undefined,
      30_000,
      "outcome publication claim",
    )
    releaseStateRead()

    const abandonmentResult = await abandonment
    await supervisorExit
    supervisors.delete(supervisor)
    expect(abandonmentResult).toBeUndefined()
    expect(JSON.parse(await readFile(join(item.runDir, "publishing.json"), "utf8"))).toMatchObject({
      version: 1,
      runId: "run-1",
      attempt: 1,
      finishedAt: expect.any(String),
    })
    const outcome = JSON.parse(await readFile(join(item.runDir, "outcome.json"), "utf8"))
    expect(outcome).toMatchObject({ runId: "run-1", attempt: 1, childExit: { code: 0 }, timedOut: false })
    expect(existsSync(join(item.runDir, "abandoned.json"))).toBe(false)
    expect(completedAsFailed).toBe(false)

    const finalized = await reconcileReflectionRuns({ identity: item.identity, reservation })
    expect(finalized).toEqual([{ runId: "run-1", outcome: "no_changes" }])
    expect(JSON.parse(await readFile(join(item.runDir, "final.json"), "utf8"))).toMatchObject({
      runId: "run-1",
      outcome: "no_changes",
    })
  }, 30_000)
})
