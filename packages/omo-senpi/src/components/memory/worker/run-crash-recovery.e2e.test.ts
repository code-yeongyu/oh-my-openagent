import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, readMemoryReceipts, receiptIdentity, type MemoryKillPoint } from "@oh-my-opencode/memory-core"

// Every case runs a launcher, a supervisor, a bootstrap and a model child, then an out-of-process
// reconciliation. Synchronisation is on process exit events and durable files, never on time.
setDefaultTimeout(120_000)

const DRIVER = join(import.meta.dir, "__fixtures__", "crash-driver.ts")
const RUN_ID = "run-1"
// Reconciliation leaves a reservation alone for the first minute in case its launcher is still
// writing; the reconcile child starts past that window, as the next session start would.
const PAST_LAUNCH_WINDOW_MS = "61000"
const FINALIZATION_FIELDS = new Set([
  "finalizePhase", "validatedTipSha", "validatedChangedPaths", "integrationSha",
  "finalizeOutcome", "finalizeReason", "finalizeDetail", "finalizedAt", "cleanupIncomplete",
])
const EVIDENCE = ["prelaunch.json", "launch.json", "transcript-payload.json", "outcome.json", "stdout.log", "stderr.log", "child-stderr.log"]

const roots: string[] = []
const pids: number[] = []

afterEach(async () => {
  const survivors = pids.splice(0).filter(isAlive)
  for (const pid of survivors) process.kill(pid, "SIGKILL")
  expect(survivors).toEqual([])
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

interface Hermetic {
  readonly root: string
  readonly env: Readonly<Record<string, string>>
  readonly paths: ReturnType<typeof buildIdentityPaths>
}

async function hermetic(): Promise<Hermetic> {
  const root = await mkdtemp(join(tmpdir(), "memory-crash-recovery-"))
  roots.push(root)
  const home = join(root, "home")
  const temp = join(root, "tmp")
  await mkdir(home, { recursive: true })
  await mkdir(temp, { recursive: true })
  const gitconfig = join(root, "gitconfig")
  await writeFile(gitconfig, "[user]\n\tname = Crash Recovery\n\temail = crash@example.invalid\n")
  const env: Record<string, string> = {}
  for (const name of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "COMSPEC", "PATHEXT", "WINDIR", "LANG"]) {
    const inherited = process.env[name]
    if (inherited !== undefined) env[name] = inherited
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitconfig,
  })
  return { root, env, paths: buildIdentityPaths(root, "agent-test") }
}

interface Exit {
  readonly pid: number
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function drive(item: Hermetic, args: readonly string[], killPoint?: MemoryKillPoint): Promise<Exit> {
  const env: Record<string, string> = { ...item.env }
  if (killPoint !== undefined) env.OMO_MEMORY_KILL_POINT = killPoint
  const child = spawn(process.execPath, [DRIVER, "--root", item.root, ...args], { env, stdio: ["ignore", "pipe", "pipe"] })
  if (child.pid === undefined) throw new Error("driver did not start")
  pids.push(child.pid)
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += String(chunk) })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })
  return await new Promise<Exit>((resolve, reject) => {
    const bound = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`driver ${args.join(" ")} did not exit\n${stdout}\n${stderr}`))
    }, 100_000)
    child.on("error", reject)
    child.on("close", (code, signal) => {
      clearTimeout(bound)
      resolve({ pid: child.pid ?? -1, code, signal, stdout, stderr })
    })
  })
}

function expectKilled(exit: Exit): void {
  if (process.platform === "win32") {
    expect(exit.signal).toBeNull()
    expect(exit.code).not.toBe(0)
  } else {
    expect({ signal: exit.signal, stderr: exit.stderr }).toMatchObject({ signal: "SIGKILL" })
  }
}

function expectSupervisorKilled(exit: Exit): void {
  expect(exit.stdout).toMatch(process.platform === "win32" ? /supervisor-exit: memory run supervisor exited with [1-9]/ : /supervisor-exit: memory run supervisor exited with SIGKILL/)
}

async function reconcile(item: Hermetic, extra: readonly string[] = []): Promise<Exit> {
  const exit = await drive(item, ["--reconcile", "--now-offset-ms", PAST_LAUNCH_WINDOW_MS, ...extra])
  expect({ code: exit.code, stderr: exit.stderr }).toMatchObject({ code: 0 })
  return exit
}

function runDir(item: Hermetic): string {
  return join(item.paths.reflection, "runs", RUN_ID)
}

async function snapshotRun(item: Hermetic): Promise<Map<string, string>> {
  const dir = runDir(item)
  if (!existsSync(dir)) return new Map()
  const names = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(dir, name), "utf8")] as const)))
}

/** In write order: the reader returns the newest receipt first. */
async function terminalEvents(item: Hermetic): Promise<string[]> {
  const { receipts } = await readMemoryReceipts(item.paths.runtime, {})
  return [...receipts].reverse()
    .filter((receipt) => receipt.kind !== "facts" && receipt.runId === RUN_ID && receipt.event !== "launched")
    .map((receipt) => receipt.event)
}

function omoRunCommits(item: Hermetic): number {
  const log = execFileSync("git", ["-C", item.paths.repo, "log", "--format=%B", "HEAD"], { env: item.env, encoding: "utf8" })
  return log.split("\n").filter((line) => line.trim() === `Omo-Run: ${RUN_ID}`).length
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
}

async function recordProcesses(item: Hermetic): Promise<void> {
  const ledgerPath = join(runDir(item), "ledger.json")
  if (!existsSync(ledgerPath)) return
  const ledger = await json(ledgerPath)
  for (const pid of [ledger.pid, ledger.childPid]) if (typeof pid === "number") pids.push(pid)
}

async function expectEvidencePreserved(item: Hermetic, before: Map<string, string>): Promise<void> {
  const after = await snapshotRun(item)
  for (const name of EVIDENCE) {
    if (!before.has(name)) continue
    expect({ name, content: after.get(name) }).toEqual({ name, content: before.get(name) })
  }
  const ledgerBefore = before.get("ledger.json")
  const ledgerAfter = after.get("ledger.json")
  if (ledgerBefore === undefined) return
  if (ledgerAfter === undefined) throw new Error("ledger.json disappeared")
  const identity = (text: string) => Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>)
    .filter(([key]) => !FINALIZATION_FIELDS.has(key)))
  expect(identity(ledgerAfter)).toEqual(identity(ledgerBefore))
}

interface Row {
  readonly name: string
  readonly point: MemoryKillPoint
  readonly child?: "commit" | "noop" | "commit-fail" | "commit-hang" | "commit-late-ok"
  readonly deadlineMs?: number
  readonly killSelf?: boolean
  readonly killed: "launcher" | "supervisor" | "supervisor-and-launcher"
  readonly terminal: { readonly file: "abandoned.json"; readonly reason: string } | { readonly file: "final.json"; readonly outcome: string; readonly reason?: string }
  readonly events: readonly string[]
  readonly commits: 0 | 1
}

const ROWS: readonly Row[] = [
  { name: "after-reserve", point: "after-reserve", killed: "launcher", terminal: { file: "abandoned.json", reason: "launch_interrupted" }, events: ["abandoned"], commits: 0 },
  { name: "after-prelaunch", point: "after-prelaunch", killed: "launcher", terminal: { file: "abandoned.json", reason: "launch_interrupted" }, events: ["abandoned"], commits: 0 },
  { name: "after-worktree", point: "after-worktree", killed: "launcher", terminal: { file: "abandoned.json", reason: "launch_interrupted" }, events: ["abandoned"], commits: 0 },
  { name: "after-child-exit with the launcher alive", point: "after-child-exit", killed: "supervisor", terminal: { file: "final.json", outcome: "merged" }, events: ["recovered", "merged"], commits: 1 },
  { name: "after-child-exit with the launcher dead too", point: "after-child-exit", killSelf: true, killed: "supervisor-and-launcher", terminal: { file: "final.json", outcome: "merged" }, events: ["recovered", "merged"], commits: 1 },
  { name: "after-validate", point: "after-validate", killed: "launcher", terminal: { file: "final.json", outcome: "merged" }, events: ["recovered", "merged"], commits: 1 },
  { name: "after-merge", point: "after-merge", killed: "launcher", terminal: { file: "final.json", outcome: "merged" }, events: ["recovered", "merged"], commits: 1 },
  { name: "before-receipt", point: "before-receipt", killed: "launcher", terminal: { file: "final.json", outcome: "merged" }, events: ["merged"], commits: 1 },
  { name: "after-child-exit control: the child committed nothing", point: "after-child-exit", child: "noop", killed: "supervisor", terminal: { file: "final.json", outcome: "failed", reason: "supervisor_failed" }, events: ["failed"], commits: 0 },
  { name: "after-child-exit: the child committed then exited 1", point: "after-child-exit", child: "commit-fail", killed: "supervisor", terminal: { file: "final.json", outcome: "failed", reason: "supervisor_failed" }, events: ["failed"], commits: 0 },
  { name: "after-child-exit: the child committed then ran past its deadline", point: "after-child-exit", child: "commit-hang", deadlineMs: 4_000, killed: "supervisor", terminal: { file: "final.json", outcome: "failed", reason: "supervisor_failed" }, events: ["failed"], commits: 0 },
  { name: "after-child-exit: the child committed and exited 0 only after its deadline", point: "after-child-exit", child: "commit-late-ok", deadlineMs: 4_000, killed: "supervisor", terminal: { file: "final.json", outcome: "failed", reason: "supervisor_failed" }, events: ["failed"], commits: 0 },
]

describe("memory run crash recovery at every kill point", () => {
  for (const row of ROWS) {
    test(`#given a run killed at ${row.name} #when reconciled in a fresh process #then it settles once with its evidence intact`, async () => {
      // given
      const item = await hermetic()
      const run = await drive(item, [
        "--run",
        ...(row.child === undefined ? [] : ["--child", row.child]),
        ...(row.deadlineMs === undefined ? [] : ["--deadline-ms", String(row.deadlineMs)]),
        ...(row.killSelf === true ? ["--kill-self-after-supervisor-exit"] : []),
      ], row.point)
      await recordProcesses(item)
      if (row.killed === "supervisor") {
        expectSupervisorKilled(run)
        expect({ code: run.code, stderr: run.stderr }).toMatchObject({ code: 0 })
      } else {
        expectKilled(run)
        if (row.killed === "supervisor-and-launcher") expectSupervisorKilled(run)
      }
      const reservation = existsSync(join(item.paths.reflection, "active.lock"))
        ? await json(join(item.paths.reflection, "active.lock"))
        : undefined
      const before = await snapshotRun(item)

      // when
      await reconcile(item)

      // then
      const terminal = await json(join(runDir(item), row.terminal.file))
      if (row.terminal.file === "abandoned.json") {
        expect(terminal).toMatchObject({
          version: 1, runId: RUN_ID, reason: row.terminal.reason, kind: "reflection", trigger: "step-count",
          generation: reservation?.reservedAt,
        })
        expect(existsSync(join(runDir(item), "ledger.json"))).toBe(false)
      } else {
        expect(terminal).toMatchObject({ outcome: row.terminal.outcome, ...(row.terminal.reason === undefined ? {} : { reason: row.terminal.reason }) })
      }
      expect(await terminalEvents(item)).toEqual([...row.events])
      expect(omoRunCommits(item)).toBe(row.commits)
      expect(existsSync(join(item.paths.reflection, "active.lock"))).toBe(false)
      await expectEvidencePreserved(item, before)
    })
  }

  for (const [label, point, dream] of [
    ["a reflection run killed after-reserve", "after-reserve", false],
    ["a dream run killed after-prelaunch", "after-prelaunch", true],
  ] as const) {
    test(`#given ${label} whose abandoned receipt write is lost #when reconciled again #then exactly one receipt carries the sentinel's identity`, async () => {
      // given
      const item = await hermetic()
      expectKilled(await drive(item, ["--run", ...(dream ? ["--dream"] : [])], point))
      const lost = await reconcile(item, ["--fail-receipt", "abandoned"])
      const sentinel = await json(join(runDir(item), "abandoned.json"))
      const afterLoss = await terminalEvents(item)

      // when
      await reconcile(item)

      // then
      expect(lost.stdout).toContain("injected receipt loss for abandoned")
      expect(afterLoss).toEqual([])
      expect(sentinel).toMatchObject(dream
        ? { kind: "dream", trigger: "dream", origin: "idle" }
        : { kind: "reflection", trigger: "step-count" })
      const { receipts } = await readMemoryReceipts(item.paths.runtime, {})
      const written = receipts.filter((receipt) => receipt.kind !== "facts" && receipt.runId === RUN_ID && receipt.event === "abandoned")
      expect(written).toHaveLength(1)
      const [receipt] = written
      if (receipt === undefined || receipt.kind === "facts") throw new Error("expected one run receipt")
      expect(receipt.kind).toBe(dream ? "dream" : "reflection")
      expect(receiptIdentity({ kind: receipt.kind, runId: receipt.runId, event: receipt.event, generation: receipt.generation }))
        .toBe(receiptIdentity({ kind: dream ? "dream" : "reflection", runId: RUN_ID, event: "abandoned", generation: String(sentinel.generation) }))
    })
  }
})
