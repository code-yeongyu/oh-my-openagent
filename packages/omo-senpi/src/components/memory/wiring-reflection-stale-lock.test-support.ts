import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

import { shutdownDeadlineAt } from "./shutdown-drain"
import { createMemoryIdentityContext } from "./context"
import { FactsExtractorRunner } from "./facts-runner"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import type { ActiveHolderSeams } from "./reflection-stale-active"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryMaintenance } from "./memory-maintenance"
import { createMemoryWiring, type MemoryWiringOptions } from "./wiring"
import { writeRunJsonAtomic } from "./worker/run-artifacts"
import { reconcileReflectionRuns } from "./worker/run-reconciliation"

const fixtures: Array<{ readonly root: string; shutdown: () => Promise<void> }> = []
const SESSION_ID = "session-1"

export async function cleanupStaleLockFixtures(): Promise<void> {
  for (const fixture of fixtures.splice(0)) {
    await fixture.shutdown()
    await rm(fixture.root, { recursive: true, force: true })
  }
}

// A pid that provably belongs to no live process: a child that has already exited.
export async function deadPid(): Promise<number> {
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

export async function staleLockFixture(seams?: ActiveHolderSeams, options: { readonly reconcileReleases?: boolean; readonly createFactsExtractor?: MemoryWiringOptions["createFactsExtractor"] } = {}) {
  const eventCtx = createEventCtx()
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-reflection-stale-lock-")))
  const fixture = { root, shutdown: async (): Promise<void> => {} }
  fixtures.push(fixture)
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
    settled: async () => {},
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
  const settlements: Array<() => Promise<void>> = []
  const wiring = createMemoryWiring({
    sessions: new Map([[SESSION_ID, { context: identity }]]),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    cwd: () => root,
    env: {},
    createRuntime: () => runtime,
    createFactsExtractor: (input) => {
      const extractor = options.createFactsExtractor?.(input) ?? new FactsExtractorRunner(input)
      settlements.push(async () => { await extractor.cancelActive?.() })
      return extractor
    },
    createMaintenance: (input) => {
      const maintenance = createMemoryMaintenance(input)
      settlements.push(async () => {
        maintenance.dispose()
        await maintenance.settled()
      })
      return maintenance
    },
    ...(seams === undefined ? {} : { reflectionHolderSeams: seams }),
  })
  fixture.shutdown = async () => {
    await wiring.onSessionShutdown({ reason: "reload", sessionId: SESSION_ID, deadlineAt: shutdownDeadlineAt(Date.now) })
    // Production shutdown is bounded; fixture removal must await these exact writers even if its budget expired.
    await Promise.all(settlements.map((settle) => settle()))
  }
  const pi = new MemoryFakeExtensionAPI()
  wiring.registerStatic(pi, componentContext())
  await wiring.afterBind(pi, SESSION_ID, identity, eventCtx)
  return { root, paths, memoryIdentity, repo, journal, store, launched, reconciles, pi, eventCtx }
}

type Fixture = Awaited<ReturnType<typeof staleLockFixture>>

let inputCounter = 0

export async function settleTurn(item: Fixture): Promise<void> {
  const inputId = `input-${++inputCounter}`
  await item.pi.dispatch("input", { type: "input", source: "rpc", inputId, text: "Work on this." }, item.eventCtx)
  await item.pi.dispatch("input_disposition", { type: "input_disposition", inputId, disposition: "started" }, item.eventCtx)
  await item.pi.dispatch("agent_end", { aborted: false, willRetry: false }, item.eventCtx)
  await item.pi.dispatch("agent_settled", {}, item.eventCtx)
}

// The shape from #10377: the child finished and recorded its outcome, publish had claimed the run,
// and then the supervising host died, so the launcher and the publish claimant are both gone.
export async function hostDiesMidPublish(item: Fixture, pid: number): Promise<string> {
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

export async function runReflect(item: Fixture): Promise<string> {
  const command = item.pi.commands.find((entry) => entry.name === "reflect")
  if (command === undefined) throw new Error("reflect command not registered")
  const handler = command.options.handler as (args: string, ctx: unknown) => Promise<string>
  return handler("", item.eventCtx)
}

export function activeRunId(item: Fixture): Promise<string | undefined> {
  return item.store.readState().then((state) => state.active?.runId)
}
