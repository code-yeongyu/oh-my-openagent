import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  advanceTestClock,
  createTestClock,
  waitForFilesystemState,
} from "./supervisor-test-signals"

// Real supervisor + bootstrap + model child spawns; a loaded CI runner needs far more than the
// 5s these waiters originally assumed. The waits stay event-driven (fs/exit signals), so a true
// hang still fails - only the ceiling moves.
const WAIT_MS = 60_000
setDefaultTimeout(WAIT_MS)

const supervisorPath = join(import.meta.dir, "memory-run-supervisor.ts")
const childFixture = join(import.meta.dir, "__fixtures__", "supervisor-child.ts")
const taskkillFixture = join(import.meta.dir, "__fixtures__", "supervisor-taskkill.ts")
const roots: string[] = []
const liveProcesses = new Set<number>()
const platforms = ["posix", "win32"] as const

async function waitForPath(path: string, timeoutMs = WAIT_MS): Promise<void> {
  await waitForFilesystemState(dirname(path), () => existsSync(path) ? true : undefined, timeoutMs, path)
}

async function makeRun(mode: "graceful" | "stubborn"): Promise<{
  runDir: string
  clockPath: string
  childExited: Promise<void>
}> {
  const runDir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-run-supervisor-ic8-")))
  roots.push(runDir)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const clockPath = await createTestClock(runDir, 1_000)
  const exitServer = createServer()
  await new Promise<void>((resolve, reject) => {
    exitServer.once("error", reject)
    exitServer.listen(0, "127.0.0.1", resolve)
  })
  const address = exitServer.address() as AddressInfo
  const childExited = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`waited ${WAIT_MS}ms for model child exit`)), WAIT_MS)
    exitServer.once("connection", () => {
      exitServer.close(() => {
        clearTimeout(timeout)
        resolve()
      })
    })
  })
  await writeFile(join(runDir, "ledger.json"), `${JSON.stringify({ version: 1, runId: "run-ic8", kind: "reflection" })}\n`)
  await writeFile(join(runDir, "launch.json"), `${JSON.stringify({
    version: 1,
    runId: "run-ic8",
    kind: "reflection",
    command: process.execPath,
    args: [childFixture, mode, runDir],
    cwd: runDir,
    env: { ...process.env, OMO_MEMORY_SUPERVISOR_EXIT_PORT: String(address.port) },
    hardDeadlineAt: 2_000,
    terminationGraceMs: 1_000,
    maxOutputBytes: 65_536,
    stdoutPath: join(runDir, "child-stdout.log"),
    stderrPath: join(runDir, "child-stderr.log"),
  })}\n`, { mode: 0o600 })
  return { runDir, clockPath, childExited }
}

function launchSupervisor(runDir: string, clockPath: string, platform: typeof platforms[number]): ChildProcess {
  const child = spawn(process.execPath, [supervisorPath, runDir], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OMO_MEMORY_SUPERVISOR_ALLOW_TEST_SEAMS: "1",
      OMO_MEMORY_SUPERVISOR_PLATFORM: platform,
      OMO_MEMORY_SUPERVISOR_CLOCK_PATH: clockPath,
      OMO_MEMORY_SUPERVISOR_TASKKILL_COMMAND: JSON.stringify([process.execPath, taskkillFixture]),
      OMO_MEMORY_SUPERVISOR_TASKKILL_RUN_DIR: runDir,
      ...(process.platform === "win32" && platform === "posix"
        ? { OMO_MEMORY_SUPERVISOR_POSIX_SIGNAL_COMMAND: JSON.stringify([process.execPath, taskkillFixture]) }
        : {}),
    },
  })
  if (child.pid !== undefined) liveProcesses.add(child.pid)
  return child
}

async function advanceClock(path: string, value: number): Promise<void> {
  await advanceTestClock(path, value)
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`waited ${WAIT_MS}ms for process exit`)), WAIT_MS)
    child.once("error", reject)
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      if (child.pid !== undefined) liveProcesses.delete(child.pid)
      resolve({ code, signal })
    })
  })
}

// process.kill on win32 terminates only the named process, leaving the bootstrap and model child
// holding the run directory; taskkill /T /F takes the whole tree so cleanup can proceed.
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
    return
  }
  process.kill(pid, "SIGKILL")
}

afterEach(async () => {
  for (const pid of liveProcesses) {
    try {
      killTree(pid)
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
    }
  }
  liveProcesses.clear()
  // Windows releases file handles asynchronously when killed processes die, so an immediate
  // recursive rm can hit EBUSY there; bounded retries absorb the lag without weakening cleanup.
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })))
})

describe("memory run supervisor IC-8 containment", () => {
  test("#given injected Windows and a child that exits during grace #when the hard deadline arrives #then the supervisor cancels forced taskkill", async () => {
    // given
    const { runDir, clockPath, childExited } = await makeRun("graceful")
    const supervisor = launchSupervisor(runDir, clockPath, "win32")
    const exit = waitForExit(supervisor)
    await waitForPath(join(runDir, "child-started.json"))

    // when
    await advanceClock(clockPath, 2_000)
    await childExited
    const result = await exit
    const outcome = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8")) as {
      readonly timedOut: boolean
      readonly childExit: { readonly code: number | null; readonly signal: string | null }
    }
    await advanceClock(clockPath, 3_000)

    // then
    expect(result).toEqual({ code: 0, signal: null })
    expect(outcome.timedOut).toBe(true)
    if (process.platform === "win32") expect(outcome.childExit).toEqual({ code: null, signal: "SIGTERM" })
    else expect(outcome.childExit).toEqual({ code: 0, signal: null })
    expect(existsSync(join(runDir, "taskkill-invocation.json"))).toBe(false)
  }, 60_000)

  for (const platform of platforms) {
    test(`#given the injected ${platform} branch #when the absolute deadline instants are advanced #then graceful and hard tree termination use those instants`, async () => {
      // given
      const { runDir, clockPath, childExited } = await makeRun("stubborn")
      const supervisor = launchSupervisor(runDir, clockPath, platform)
      const exit = waitForExit(supervisor)
      await waitForPath(join(runDir, "child-started.json"))
      expect(existsSync(join(runDir, "child-terminated.json"))).toBe(false)

      // when
      await advanceClock(clockPath, 2_000)
      if (supervisor.pid === undefined) throw new Error("supervisor pid is required")
      await waitForPath(join(runDir, `${platform === "win32" ? "win32-graceful" : "posix-SIGTERM"}-${supervisor.pid}.json`))
      expect(existsSync(join(runDir, "taskkill-invocation.json"))).toBe(false)
      await advanceClock(clockPath, 3_000)
      await waitForPath(join(runDir, "outcome.json"))
      await Promise.all([exit, childExited])

      // then
      const outcome = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8")) as Record<string, unknown>
      expect(outcome.timedOut).toBe(true)
      if (platform === "win32") {
        const invocation = JSON.parse(await readFile(join(runDir, "taskkill-invocation.json"), "utf8")) as { readonly args: string[] }
        expect(invocation.args.slice(-4)).toEqual(["/pid", expect.any(String), "/T", "/F"])
      } else {
        expect(existsSync(join(runDir, "taskkill-invocation.json"))).toBe(false)
      }
    }, 60_000)

    test(`#given the injected ${platform} branch and a released child #when the supervisor dies abruptly #then the bootstrap alone enforces the persisted deadline`, async () => {
      // given
      const { runDir, clockPath, childExited } = await makeRun("graceful")
      const supervisor = launchSupervisor(runDir, clockPath, platform)
      const exit = waitForExit(supervisor)
      await waitForPath(join(runDir, "child-started.json"))
      const ledger = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8")) as { readonly childPid: number }
      liveProcesses.add(ledger.childPid)

      // when
      supervisor.kill("SIGKILL")
      await exit
      expect(existsSync(join(runDir, "outcome.json"))).toBe(false)
      await advanceClock(clockPath, 2_000)
      await waitForPath(join(runDir, `${platform === "win32" ? "win32-graceful" : "posix-SIGTERM"}-${ledger.childPid}.json`))
      await childExited
      liveProcesses.delete(ledger.childPid)

      // then
      expect(existsSync(join(runDir, "outcome.json"))).toBe(false)
    }, 60_000)
  }
})
