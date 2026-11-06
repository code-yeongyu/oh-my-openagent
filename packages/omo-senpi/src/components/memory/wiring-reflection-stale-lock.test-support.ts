import { execFileSync, spawn } from "node:child_process"
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  LockContentionError,
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
import { classifyActiveReflectionHolder, type ActiveHolderSeams, type ActiveHolderVerdict } from "./reflection-stale-active"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryMaintenance } from "./memory-maintenance"
import { createMemoryWiring, type MemoryWiringOptions } from "./wiring"
import { writeRunJsonAtomic } from "./worker/run-artifacts"
import type { ReservationStatePort } from "./worker/run-finalization-types"
import { reconcileReflectionRuns, type ReflectionRunReconcileResult } from "./worker/run-reconciliation"

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

// Diagnostics for #11604: a failed assertion names the branch that left the dead run unfinalized,
// so one CI failure is enough evidence. Observation only: every call is forwarded unchanged.
type SchedulerContention = {
  readonly pass: number
  readonly read: "readState" | "complete"
  readonly waitTimeoutMs: number | undefined
  readonly site: string
  readonly lockPath: string
  readonly owner: unknown
}

export function callerSite(stack: string | undefined): string {
  // Windows stacks print backslash paths; both separators name the same worker frame.
  const frames = (stack ?? "").split("\n").filter((line) => /worker[\\/]run-[\w-]+\.ts:\d+/.test(line))
  return frames[0]?.trim() ?? "unknown site"
}

function observeContention(store: ReservationStatePort, contention: SchedulerContention[], pass: number): ReservationStatePort {
  async function observed<T>(read: SchedulerContention["read"], waitTimeoutMs: number | undefined, site: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof LockContentionError) contention.push({ pass, read, waitTimeoutMs, site, lockPath: error.lockPath, owner: error.owner })
      throw error
    }
  }
  return {
    readState: (options) => observed("readState", options?.waitTimeoutMs, callerSite(new Error().stack), () => store.readState(options)),
    complete: (runId, outcome, options) => observed("complete", options?.waitTimeoutMs, callerSite(new Error().stack), () => store.complete(runId, outcome, options)),
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
  const reconciles = {
    count: 0,
    results: [] as Array<{ readonly pass: number; readonly results: ReflectionRunReconcileResult[] }>,
    contention: [] as SchedulerContention[],
    errors: [] as Array<{ readonly pass: number; readonly error: string }>,
    // Called synchronously when a pass starts, after it took its number.
    onStart: undefined as ((pass: number) => void) | undefined,
  }
  const holders: Array<{ readonly runId: string; readonly pid: number; readonly hostname: string }> = []
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
      // Passes are numbered from 1 (the count after this call); a mark holds the count before the step under test.
      const pass = reconciles.count
      reconciles.onStart?.(pass)
      if (options.reconcileReleases === false) return
      const reservation = observeContention(store, reconciles.contention, pass)
      try {
        reconciles.results.push({ pass, results: await reconcileReflectionRuns({ identity: memoryIdentity, reservation, launch, deferOnSchedulerContention: true }) })
      } catch (error) {
        // The wiring swallows a reconcile failure into its logger; keep it for the diagnosis, then rethrow unchanged.
        reconciles.errors.push({ pass, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
        throw error
      }
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
  return { root, paths, memoryIdentity, repo, journal, store, launched, reconciles, holders, pi, eventCtx }
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
export async function hostDiesMidPublish(item: Fixture, pid: number, now: () => number = Date.now): Promise<string> {
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
  const startedAt = now()
  const hardDeadlineAt = startedAt + 600_000
  const terminationGraceMs = 100
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId,
    attempt: 1,
    category: "quick",
    conversationIds: [SESSION_ID],
    kind: "reflection",
    trigger: "manual",
    startedAt: new Date(startedAt).toISOString(),
    hardDeadlineAt,
    terminationGraceMs,
    deadlineAt: hardDeadlineAt + terminationGraceMs,
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
  const launcherHostname = hostname()
  await writeFile(activePath, `${JSON.stringify({ ...active, launcherPid: pid, launcherHostname }, null, 2)}\n`, { mode: 0o600 })
  item.holders.push({ runId, pid, hostname: launcherHostname })
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

export function holderVerdict(item: Fixture): Promise<ActiveHolderVerdict> {
  return classifyActiveReflectionHolder(item.paths.reflection)
}

function bootId(): string {
  try {
    if (process.platform === "darwin") return execFileSync("sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" }).trim()
    if (process.platform === "linux") return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  } catch (error) {
    return `unavailable (${error instanceof Error ? error.message : String(error)})`
  }
  return "unavailable on this platform"
}

/** Where the reconcile bookkeeping stood before the step under test; the diagnosis reads only what came after. */
export type DiagnosisMark = { readonly count: number }

export function diagnosisMark(item: Fixture): DiagnosisMark {
  return { count: item.reconciles.count }
}

/**
 * The reconcile evidence of passes that STARTED after the mark, all cut by pass number. A pass already
 * running when the mark was taken belongs to the time before it, even if its result lands later.
 */
export function afterMark(item: Fixture, mark: DiagnosisMark) {
  const after = (entry: { readonly pass: number }) => entry.pass > mark.count
  return {
    reconciled: item.reconciles.count - mark.count,
    passes: item.reconciles.results.filter(after),
    contention: item.reconciles.contention.filter(after),
    errors: item.reconciles.errors.filter(after),
  }
}

// Locks held right now, by file name and owner purpose/pid. A per-run finalize claim or the writer lock is
// taken inside reconciliation where the reservation port cannot see it; a holder still present shows here.
function heldLocks(locksDir: string): string {
  let names: string[]
  try {
    names = readdirSync(locksDir).filter((name) => name.endsWith(".lock")).sort()
  } catch (error) {
    return `unreadable (${error instanceof Error ? error.message : String(error)})`
  }
  if (names.length === 0) return "none"
  return names.map((name) => {
    try {
      const owner = JSON.parse(readFileSync(join(locksDir, name), "utf8")) as { purpose?: unknown; pid?: unknown; hostname?: unknown }
      return `${name} (${String(owner.purpose)} pid ${String(owner.pid)} on ${String(owner.hostname)})`
    } catch (error) {
      return `${name} (owner unreadable: ${error instanceof Error ? error.message : String(error)})`
    }
  }).join(", ")
}

/**
 * "finalized" when the dead run settled; otherwise names the branch that skipped it (#11604):
 * A = the holder verdict was not "dead" (each label states only that verdict and how many reconcile
 *     passes started after the mark), or the verdict was dead and no pass started;
 * B = reconciliation ran and deferred on reservation-port contention, or threw. Anything else is
 * "unclassified" with the raw evidence, never a claim that no lock was contended.
 */
export async function staleRunDiagnosis(
  item: Fixture,
  runId: string,
  observed: { readonly verdictBefore: ActiveHolderVerdict; readonly surface: string; readonly mark: DiagnosisMark },
): Promise<string> {
  if (existsSync(join(item.paths.reflection, "runs", runId, "final.json"))) return "finalized"
  const holder = item.holders.find((entry) => entry.runId === runId)
  const verdictAfter = await holderVerdict(item)
  const host = `recorded host ${holder?.hostname ?? "unknown"}, current host ${hostname()}, boot ${bootId()}`
  const { reconciled, passes, contention, errors } = afterMark(item, observed.mark)
  const ran = `reconcile ran ${reconciled} time(s) after the mark`
  const branch = observed.verdictBefore.state === "live"
    ? `A live: holder verdict live; ${ran}`
    : observed.verdictBefore.state === "stuck"
      ? `A stuck: ${observed.verdictBefore.reason}; ${ran}`
      : observed.verdictBefore.state === "none"
        ? `A none: active.lock was gone before recovery; ${ran}`
        : reconciled === 0
          ? `A not reconciled: holder verdict dead; ${ran}`
          : errors.length > 0
            ? `B threw: ${errors.map((entry) => `pass ${entry.pass}: ${entry.error}`).join("; ")}`
            : contention.length > 0
              ? `B deferred: ${contention.map((entry) => `pass ${entry.pass} ${entry.read}(waitTimeoutMs=${String(entry.waitTimeoutMs)}) from ${entry.site.replace(/^at /, "")} on ${entry.lockPath} held by ${JSON.stringify(entry.owner)}`).join("; ")}`
              : "unclassified: reconcile ran without settling the run and no reservation-port contention was observed (a finalize claim or writer lock held elsewhere is not visible to the port; see locks)"
  return [
    branch,
    `verdict before ${JSON.stringify(observed.verdictBefore)}, after ${JSON.stringify(verdictAfter)}`,
    `holder pid ${holder?.pid ?? "unknown"}; ${host}`,
    `reconcile calls after the mark ${reconciled}, passes returned ${JSON.stringify(passes)}`,
    `locks held now: ${heldLocks(item.paths.locks)}`,
    `surface: ${observed.surface}`,
  ].join("\n")
}
