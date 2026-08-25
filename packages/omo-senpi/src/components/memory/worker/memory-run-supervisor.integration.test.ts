import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { rmEfaultTolerant } from "../teardown.test-support"
import {
  advanceTestClock,
  createTestClock,
  waitForFilesystemState,
} from "./supervisor-test-signals"

// Each case drives a real supervisor, bootstrap, and model child - three spawned bun processes
// plus git work. The 5s default is a fast-machine assumption, not a budget those subprocesses
// fit on a loaded CI runner; the assertions stay event-driven with no sleeps.
const WAIT_MS = 60_000
setDefaultTimeout(WAIT_MS)

const supervisorPath = join(import.meta.dir, "memory-run-supervisor.ts")
const childFixture = join(import.meta.dir, "__fixtures__", "supervisor-child.ts")
const parentFixture = join(import.meta.dir, "__fixtures__", "supervisor-parent.ts")
const roots: string[] = []
const processGroups = new Set<number>()
const WINDOWS_CLEANUP_RACE_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"])

// Windows releases file handles asynchronously when killed processes die, so an immediate recursive
// rm can hit EBUSY there; bounded retries absorb the lag without weakening cleanup. A tree-killed
// child can still outlast that window, and stalling here bills the next test file's budget, so the
// platform's known cleanup races are tolerated while every other cleanup defect fails loudly.
async function removeRoot(root: string): Promise<void> {
  try {
    await rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && typeof error.code === "string"
      && WINDOWS_CLEANUP_RACE_CODES.has(error.code)
    ) return
    throw error
  }
}

interface Outcome {
  readonly version: 1
  readonly runId: string
  readonly attempt?: number
  readonly childExit: { readonly code: number | null; readonly signal: string | null }
  readonly timedOut: boolean
}

async function makeRun(options: {
  readonly mode: "inspect" | "graceful" | "stubborn" | "model-not-found"
  readonly hardDeadlineAt?: number
  readonly terminationGraceMs?: number
  readonly nextAttempt?: { readonly attempt: number; readonly model: string; readonly thinking?: string }
}): Promise<string> {
  const runDir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-run-supervisor-")))
  roots.push(runDir)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeFile(join(runDir, "ledger.json"), `${JSON.stringify({ version: 1, runId: "run-a", kind: "reflection" })}\n`)
  await writeFile(join(runDir, "launch.json"), `${JSON.stringify({
    version: 1,
    runId: "run-a",
    attempt: 1,
    kind: "reflection",
    nextAttempt: options.nextAttempt,
    command: process.execPath,
    args: [childFixture, options.mode, runDir],
    cwd: runDir,
    env: { ...process.env },
    // Non-deadline runs get a load-tolerant budget: cold bun spawns plus fsync'd identity
    // writes overshoot 10s on a loaded windows-latest runner, and the supervisor records
    // timedOut from the deadline instant being reached even when the child exited cleanly.
    hardDeadlineAt: options.hardDeadlineAt ?? Date.now() + 45_000,
    terminationGraceMs: options.terminationGraceMs ?? 1_000,
    maxOutputBytes: 65_536,
    stdoutPath: join(runDir, "child-stdout.log"),
    stderrPath: join(runDir, "child-stderr.log"),
  })}\n`, { mode: 0o600 })
  return runDir
}

function launchSupervisor(runDir: string): ChildProcess {
  const clockPath = join(runDir, "clock-events")
  const child = spawn(process.execPath, [supervisorPath, runDir], {
    detached: true,
    stdio: "ignore",
    env: existsSync(clockPath) ? {
      ...process.env,
      OMO_MEMORY_SUPERVISOR_ALLOW_TEST_SEAMS: "1",
      OMO_MEMORY_SUPERVISOR_CLOCK_PATH: clockPath,
    } : process.env,
  })
  // Track every supervisor so afterEach can tree-kill it: on win32 taskkill /T /F takes the
  // supervisor, bootstrap, and model child together, which is what releases the run directory.
  if (child.pid !== undefined) processGroups.add(child.pid)
  return child
}

async function advanceClock(runDir: string, value: number): Promise<void> {
  await advanceTestClock(join(runDir, "clock-events"), value)
}

async function waitForPath(path: string, timeoutMs = WAIT_MS): Promise<void> {
  await waitForFilesystemState(dirname(path), () => existsSync(path) ? true : undefined, timeoutMs, path)
}

async function waitForLedgerChild(runDir: string): Promise<{ readonly childPid: number }> {
  const path = join(runDir, "ledger.json")
  return await waitForFilesystemState(runDir, async () => {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
    return typeof value.childPid === "number" ? { childPid: value.childPid } : undefined
  }, WAIT_MS, "child identity")
}

async function readOutcome(runDir: string): Promise<Outcome> {
  await waitForPath(join(runDir, "outcome.json"))
  return JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8")) as Outcome
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`waited ${WAIT_MS}ms for process exit`)), WAIT_MS)
    child.once("error", reject)
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  process.kill(process.platform === "win32" ? pid : -pid, signal)
}

function groupIsAlive(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but cannot be signaled - it is alive, matching
    // isProcessAlive. Only genuine absence (ESRCH and friends) reads as dead.
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true
    return false
  }
}

// Same win32 caveat: signalGroup terminates one process on that platform; the tree must die
// for the run directory to be removable.
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
    return
  }
  signalGroup(pid, "SIGKILL")
}

afterEach(async () => {
  for (const pid of processGroups) {
    try {
      killTree(pid)
    } catch {
      continue
    }
  }
  processGroups.clear()
  await Promise.all(roots.splice(0).map(removeRoot))
})

describe("memory run supervisor", () => {
  test("#given an unrelated active handle #when the durable outcome is published #then the standalone supervisor exits", async () => {
    // given
    const runDir = await makeRun({ mode: "inspect" })
    const keepalivePath = join(import.meta.dir, "__fixtures__", "supervisor-keepalive.ts")
    const supervisor = spawn(process.execPath, [keepalivePath, runDir], {
      detached: true,
      stdio: "ignore",
    })
    if (supervisor.pid !== undefined) processGroups.add(supervisor.pid)
    const exit = waitForExit(supervisor)

    // when
    const outcome = await readOutcome(runDir)

    // then
    expect(outcome.childExit).toEqual({ code: 23, signal: null })
    await expect(exit).resolves.toEqual({ code: 0, signal: null })
  }, 60_000)

  test("#given a retryable model miss and a next attempt #when the supervisor publishes the outcome #then the ledger advances first", async () => {
    // given
    const runDir = await makeRun({
      mode: "model-not-found",
      nextAttempt: { attempt: 2, model: "omo-mock/mock-1", thinking: "minimal" },
    })

    // when
    const supervisor = launchSupervisor(runDir)
    const exit = await waitForExit(supervisor)
    const ledger = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8"))
    const outcome = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8")) as Outcome

    // then
    expect(exit).toEqual({ code: 0, signal: null })
    expect(ledger).toMatchObject({
      attempt: 2,
      model: "omo-mock/mock-1",
      thinking: "minimal",
      launching: true,
    })
    expect(outcome).toMatchObject({ attempt: 1, childExit: { code: 1 }, timedOut: false })
  }, 60_000)

  test("#given a fixture launch manifest #when supervised #then identity is durable before the command starts and the outcome is published once", async () => {
    // given
    const runDir = await makeRun({ mode: "inspect" })

    // when
    const supervisor = launchSupervisor(runDir)
    const exit = waitForExit(supervisor)
    const outcome = await readOutcome(runDir)
    await exit

    // then
    const observation = JSON.parse(await readFile(join(runDir, "child-observation.json"), "utf8")) as Record<string, unknown>
    expect(observation.pid).toBe(supervisor.pid)
    expect(typeof observation.processStart === "string" || observation.processStart === null).toBe(true)
    expect(typeof observation.childPid).toBe("number")
    expect(typeof observation.childProcessStart === "string" || observation.childProcessStart === null).toBe(true)
    expect(outcome).toMatchObject({ version: 1, runId: "run-a", childExit: { code: 23, signal: null }, timedOut: false })
    expect(existsSync(join(runDir, "launch.json"))).toBe(false)
    expect((await readdir(runDir)).filter((name) => name === "outcome.json")).toEqual(["outcome.json"])
  }, 60_000)

  test("#given a detached supervisor launched by a parent #when the parent is killed #then the supervisor still publishes the child outcome", async () => {
    // given
    const runDir = await makeRun({ mode: "inspect" })
    const parent = spawn(process.execPath, [parentFixture, supervisorPath, runDir], { stdio: ["pipe", "pipe", "inherit"] })
    const parentExit = waitForExit(parent)
    const ready = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`waited ${WAIT_MS}ms for parent launch receipt`)), WAIT_MS)
      parent.stdout?.once("data", (chunk) => {
        clearTimeout(timeout)
        resolve(String(chunk))
      })
    })
    expect(JSON.parse(ready)).toHaveProperty("supervisorPid")

    // when
    parent.kill("SIGKILL")
    await parentExit
    const outcome = await readOutcome(runDir)

    // then
    expect(outcome.childExit).toEqual({ code: 23, signal: null })
  }, 60_000)

  test("#given a bootstrap waiting for release #when its parent pipe closes #then it exits without starting the manifest command", async () => {
    // given
    const runDir = await makeRun({ mode: "inspect" })
    const bootstrap = spawn(process.execPath, [supervisorPath, "--child-bootstrap", runDir], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore", "ignore"],
    })
    const exit = waitForExit(bootstrap)

    // when
    bootstrap.stdin?.end()
    const result = await exit

    // then
    expect(result).toEqual({ code: 0, signal: null })
    expect(existsSync(join(runDir, "child-observation.json"))).toBe(false)
    expect(existsSync(join(runDir, "child-started.json"))).toBe(false)
  }, 60_000)

  test("#given a released child #when the supervisor is killed abruptly #then the recorded live process group can be terminated", async () => {
    // given
    const runDir = await makeRun({ mode: "graceful" })
    const supervisor = launchSupervisor(runDir)
    const supervisorExit = waitForExit(supervisor)
    const { childPid } = await waitForLedgerChild(runDir)
    processGroups.add(childPid)
    await waitForPath(join(runDir, "child-started.json"))

    // when
    supervisor.kill("SIGKILL")
    await supervisorExit
    if (process.platform === "win32") killTree(childPid)
    else {
      expect(groupIsAlive(childPid)).toBe(true)
      signalGroup(childPid, "SIGTERM")
      await waitForPath(join(runDir, "child-terminated.json"))
    }

    // then
    expect(existsSync(join(runDir, "outcome.json"))).toBe(false)
    expect(JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8"))).toMatchObject({ childPid })
  }, 60_000)

  test("#given a child that exits during termination grace #when the absolute deadline arrives #then timeout is recorded without escalation", async () => {
    // given
    const runDir = await makeRun({ mode: "graceful", hardDeadlineAt: 2_000, terminationGraceMs: 2_000 })
    await createTestClock(runDir, 1_000)

    // when
    const supervisor = launchSupervisor(runDir)
    const exit = waitForExit(supervisor)
    await waitForPath(join(runDir, "child-started.json"))
    await advanceClock(runDir, 2_000)
    if (process.platform === "win32") await advanceClock(runDir, 4_000)
    const outcome = await readOutcome(runDir)
    await exit

    // then
    expect(outcome.timedOut).toBe(true)
    if (process.platform !== "win32") {
      expect(outcome.childExit).toEqual({ code: 0, signal: null })
      expect(existsSync(join(runDir, "child-terminated.json"))).toBe(true)
    }
  }, 60_000)

  test("#given a child that ignores SIGTERM #when termination grace expires #then the process group is killed", async () => {
    // given
    const runDir = await makeRun({ mode: "stubborn", hardDeadlineAt: 2_000, terminationGraceMs: 100 })
    await createTestClock(runDir, 1_000)

    // when
    const supervisor = launchSupervisor(runDir)
    const exit = waitForExit(supervisor)
    await waitForPath(join(runDir, "child-started.json"))
    await advanceClock(runDir, 2_000)
    if (process.platform !== "win32") await waitForPath(join(runDir, "child-terminated.json"))
    await advanceClock(runDir, 2_100)
    const outcome = await readOutcome(runDir)
    await exit

    // then
    expect(outcome.timedOut).toBe(true)
    if (process.platform !== "win32") {
      expect(outcome.childExit).toEqual({ code: null, signal: "SIGKILL" })
      expect(existsSync(join(runDir, "child-terminated.json"))).toBe(true)
    }
  }, 60_000)
})
