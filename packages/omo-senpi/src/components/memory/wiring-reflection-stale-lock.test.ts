import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  createReflectionWorktree,
  type MemoryIdentity,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import type { ActiveHolderSeams } from "./reflection-stale-active"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"
import { createMemoryWiring } from "./wiring"
import { writeRunJsonAtomic } from "./worker/run-artifacts"
import { reconcileReflectionRuns } from "./worker/run-reconciliation"

const roots: string[] = []
const SESSION_ID = "session-1"

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  ))
})

// A pid that provably belongs to no live process: a child that has already exited.
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  const pid = child.pid
  if (pid === undefined) throw new Error("child did not start")
  await new Promise<void>((resolve) => child.once("exit", () => resolve()))
  return pid
}

function createEventCtx() {
  const notices: Array<{ message: string; level: string }> = []
  return {
    notices,
    sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
    ui: { setStatus: () => {}, notify: (message: string, level: string) => notices.push({ message, level }) },
  }
}

async function staleLockFixture(seams?: ActiveHolderSeams, options: { readonly reconcileReleases?: boolean } = {}) {
  const eventCtx = createEventCtx()
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-reflection-stale-lock-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-test")
  const memoryIdentity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths }
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: memoryIdentity.id })
  await repo.init({ seedFiles: [{ relativePath: "system/base.md", content: "---\ndescription: Base\n---\nbase\n" }] })
  const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, SESSION_ID) })
  await journal.reconcile([
    { kind: "user", messageId: "user-1", text: "remember" },
    { kind: "assistant", messageId: "assistant-1", textBlocks: ["noted"] },
  ])
  let nextRun = 64
  const store = new ReflectionReservationStore({
    identity: memoryIdentity,
    config: { stepCount: 1_000, onCompaction: false },
    getJournal: async () => journal,
    createRunId: () => `reflection-run-${nextRun++}`,
  })
  const launched: ReservedRun[] = []
  const reconciles = { count: 0 }
  const launch = (run: ReservedRun): Promise<void> => {
    launched.push(run)
    return Promise.resolve()
  }
  const runtime = {
    store,
    reservationPort: store,
    launch,
    async reconcile(): Promise<void> {
      reconciles.count += 1
      if (options.reconcileReleases === false) return
      await reconcileReflectionRuns({ identity: memoryIdentity, reservation: store, launch, deferOnSchedulerContention: true })
    },
  } as unknown as MemoryIdentityRuntime
  const identity = createMemoryIdentityContext({
    identity: "agent-test",
    identityPaths: paths,
    binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
  })
  const wiring = createMemoryWiring({
    sessions: new Map([[SESSION_ID, { context: identity }]]),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    cwd: () => root,
    env: {},
    createRuntime: () => runtime,
    ...(seams === undefined ? {} : { reflectionHolderSeams: seams }),
  })
  const pi = new MemoryFakeExtensionAPI()
  wiring.registerStatic(pi, componentContext())
  await wiring.afterBind(pi, SESSION_ID, identity, eventCtx)
  return { root, paths, memoryIdentity, repo, journal, store, launched, reconciles, pi, eventCtx }
}

type Fixture = Awaited<ReturnType<typeof staleLockFixture>>

let inputCounter = 0

async function settleTurn(item: Fixture): Promise<void> {
  const inputId = `input-${++inputCounter}`
  await item.pi.dispatch("input", { type: "input", source: "rpc", inputId, text: "Work on this." }, item.eventCtx)
  await item.pi.dispatch("input_disposition", { type: "input_disposition", inputId, disposition: "started" }, item.eventCtx)
  await item.pi.dispatch("agent_end", { aborted: false, willRetry: false }, item.eventCtx)
  await item.pi.dispatch("agent_settled", {}, item.eventCtx)
}

// The shape from #10377: the child finished and recorded its outcome, publish had claimed the run,
// and then the supervising host died, so the launcher and the publish claimant are both gone.
async function hostDiesMidPublish(item: Fixture, pid: number): Promise<string> {
  const snapshot = await item.journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected a snapshot")
  const reserved = await item.store.tryReserve({
    trigger: "manual",
    conversationIds: [SESSION_ID],
    snapshots: [{ conversationId: SESSION_ID, snapshot }],
  })
  if (reserved.status !== "active") throw new Error(`expected an active reservation, got ${reserved.status}`)
  const runId = reserved.run.runId
  const worktree = await createReflectionWorktree(item.repo, runId, item.paths.worktrees)
  await mkdir(join(worktree.dir, "system"), { recursive: true })
  await writeFile(join(worktree.dir, "system", "learned.md"), "---\ndescription: Learned\n---\nlearned\n")
  await worktree.exec.run(["add", "system/learned.md"], { cwd: worktree.dir, timeoutMs: 30_000 })
  await worktree.exec.run(["commit", "-m", "reflection"], { cwd: worktree.dir, timeoutMs: 30_000 })
  const runDir = join(item.paths.reflection, "runs", runId)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeRunJsonAtomic(join(runDir, "prelaunch.json"), {
    version: 1, runId, worktreeDir: worktree.dir, worktreeBranch: worktree.branch,
  })
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId,
    attempt: 1,
    category: "quick",
    conversationIds: [SESSION_ID],
    kind: "reflection",
    trigger: "manual",
    startedAt: new Date().toISOString(),
    hardDeadlineAt: Date.now() + 600_000,
    terminationGraceMs: 100,
    deadlineAt: Date.now() + 600_100,
    mergePolicy: "auto",
    pid,
    childPid: pid,
    worktreeDir: worktree.dir,
    worktreeBranch: worktree.branch,
    baseSha: worktree.baseSha,
    gitFilePath: worktree.gitFilePath,
    gitFileSnapshot: worktree.gitFileSnapshot,
    commonConfigPath: worktree.commonConfigPath,
    commonConfigSnapshot: worktree.commonConfigSnapshot,
  })
  await writeRunJsonAtomic(join(runDir, "outcome.json"), {
    version: 1, runId, attempt: 1, finishedAt: new Date().toISOString(), childExit: { code: 0, signal: null }, timedOut: false,
  })
  await writeRunJsonAtomic(join(runDir, "terminal-claim.json"), {
    version: 1, kind: "publish", runId, attempt: 1, claimantPid: pid,
  })
  const activePath = join(item.paths.reflection, "active.lock")
  const active = JSON.parse(await readFile(activePath, "utf8")) as Record<string, unknown>
  await writeFile(activePath, `${JSON.stringify({ ...active, launcherPid: pid, launcherHostname: hostname() }, null, 2)}\n`, { mode: 0o600 })
  return runId
}

async function runReflect(item: Fixture): Promise<string> {
  const command = item.pi.commands.find((entry) => entry.name === "reflect")
  if (command === undefined) throw new Error("reflect command not registered")
  const handler = command.options.handler as (args: string, ctx: unknown) => Promise<string>
  return handler("", item.eventCtx)
}

function activeRunId(item: Fixture): Promise<string | undefined> {
  return item.store.readState().then((state) => state.active?.runId)
}

describe("memory reflection stale active lock (#10377)", () => {
  test("#given a session that already reconciled #when the host dies mid-publish and the next /reflect finds the lock held #then the dead run is finalized and the lock released", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    expect(item.reconciles.count).toBe(1)
    const pid = await deadPid()
    const runId = await hostDiesMidPublish(item, pid)

    // when
    const reply = await runReflect(item)

    // then
    expect(existsSync(join(item.paths.reflection, "runs", runId, "final.json"))).toBe(true)
    expect(await activeRunId(item)).not.toBe(runId)
    expect(reply).toContain(`the previous run ${runId} had stopped without releasing its lock`)
    const promoted = await activeRunId(item)
    if (promoted === undefined) throw new Error("expected the queued request to become the active run")
    expect(item.launched.map((run) => run.runId)).toContain(promoted)
  }, 30_000)

  test("#given a session that already reconciled #when the host dies mid-publish and a later turn settles #then the dead run is finalized", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    const pid = await deadPid()
    const runId = await hostDiesMidPublish(item, pid)

    // when
    await settleTurn(item)

    // then
    expect(existsSync(join(item.paths.reflection, "runs", runId, "final.json"))).toBe(true)
    expect(await activeRunId(item)).not.toBe(runId)
    expect(item.eventCtx.notices.filter((notice) => notice.message.includes("stale lock"))).toEqual([])
  }, 30_000)

  test("#given the holder's liveness cannot be checked #when /reflect and a later turn find the lock held #then nothing is reclaimed and the stuck state is shown with the next step", async () => {
    // given
    const item = await staleLockFixture({ getPidLiveness: () => "unknown" })
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, await deadPid())
    const reconcilesBefore = item.reconciles.count

    // when
    const reply = await runReflect(item)
    await settleTurn(item)

    // then
    expect(item.reconciles.count).toBe(reconcilesBefore)
    expect(existsSync(join(item.paths.reflection, "runs", runId, "final.json"))).toBe(false)
    expect(await activeRunId(item)).toBe(runId)
    expect(reply).toContain("memory reflection is stuck on a stale lock")
    expect(reply).toContain("Next step: run /doctor")
    const shown = item.eventCtx.notices.filter((notice) => notice.message.includes("memory reflection is stuck on a stale lock"))
    expect(shown.length).toBeGreaterThanOrEqual(2)
    expect(shown.every((notice) => notice.level === "warning")).toBe(true)
  }, 30_000)

  test("#given the holder is alive #when /reflect and a later turn find the lock held #then the run is left untouched and nothing is reported", async () => {
    // given
    const item = await staleLockFixture()
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, process.pid)
    const reconcilesBefore = item.reconciles.count

    // when
    const reply = await runReflect(item)
    await settleTurn(item)

    // then
    expect(item.reconciles.count).toBe(reconcilesBefore)
    expect(existsSync(join(item.paths.reflection, "runs", runId, "final.json"))).toBe(false)
    expect(await activeRunId(item)).toBe(runId)
    expect(reply).toContain("a run is already active and this request runs next")
    expect(item.eventCtx.notices.filter((notice) => notice.message.includes("stale lock"))).toEqual([])
  }, 30_000)

  test("#given a dead holder that recovery does not release #when later turns settle #then it is reconciled once and the stuck state is shown once", async () => {
    // given
    const item = await staleLockFixture(undefined, { reconcileReleases: false })
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, await deadPid())
    const reconcilesBefore = item.reconciles.count

    // when
    await settleTurn(item)
    await settleTurn(item)
    await settleTurn(item)

    // then
    expect(item.reconciles.count).toBe(reconcilesBefore + 1)
    expect(await activeRunId(item)).toBe(runId)
    const shown = item.eventCtx.notices.filter((notice) => notice.message.includes("memory reflection is stuck on a stale lock"))
    expect(shown).toHaveLength(1)
    expect(shown[0]?.message).toContain("recovering it did not release the lock")
  }, 30_000)

  test("#given active.lock cannot be read #when /reflect and a later turn find the lock held #then the stuck state is shown with the reason instead of failing", async () => {
    // given
    const item = await staleLockFixture({
      readText: async (path) => {
        if (path.endsWith("active.lock")) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
        return readFile(path, "utf8")
      },
    })
    await settleTurn(item)
    const runId = await hostDiesMidPublish(item, await deadPid())

    // when
    const reply = await runReflect(item)
    await settleTurn(item)

    // then
    expect(reply).toContain("active.lock could not be read (EACCES)")
    expect(reply).toContain("Next step: run /doctor")
    expect(await activeRunId(item)).toBe(runId)
    const shown = item.eventCtx.notices.filter((notice) => notice.message.includes("active.lock could not be read (EACCES)"))
    expect(shown.length).toBeGreaterThanOrEqual(1)
  }, 30_000)
})
