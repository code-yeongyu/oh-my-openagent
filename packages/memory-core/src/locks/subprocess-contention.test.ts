import { afterEach, describe, expect, test } from "bun:test"
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { LockContentionError, acquireLock, createLockRecord, releaseLock } from "./index"
import {
  type ProcessIdentity,
  captureIdentity,
  exitedWithin,
  killIfAlive,
  pidAlive,
  pidTerminalWithin,
  readPidFileWhenWritten,
} from "./process-liveness.test-support"

const workerPath = fileURLToPath(new URL("./subprocess-worker.ts", import.meta.url))
const temporaryDirectories: string[] = []
const children = new Set<ChildProcess>()

const READY_TIMEOUT_MS = 10_000
const EXIT_TIMEOUT_MS = 5_000
const TEARDOWN_GRACE_MS = 2_000

function track<T extends ChildProcess>(child: T): T {
  children.add(child)
  child.once("exit", () => children.delete(child))
  return child
}

function spawnWorker(args: string[]): ChildProcessWithoutNullStreams {
  return track(spawn(process.execPath, [workerPath, ...args], { stdio: ["pipe", "pipe", "pipe"] }))
}

async function killAndAwait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGKILL")
  if (!(await exitedWithin(child, TEARDOWN_GRACE_MS))) {
    throw new Error(`child pid ${String(child.pid)} survived SIGKILL for ${String(TEARDOWN_GRACE_MS)}ms`)
  }
}

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ""
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${expected}; stderr=${child.stderr.read() ?? ""}`)), 5_000)
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8")
      if (!output.includes(expected)) return
      clearTimeout(timeout)
      child.stdout.off("data", onData)
      resolve()
    }
    child.stdout.on("data", onData)
    child.once("exit", (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`child exited before output: code=${code} signal=${signal}`))
    })
  })
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for child exit")), 5_000)
    child.once("exit", (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}

async function createFixture(): Promise<{ directory: string; lockPath: string; counterPath: string; logPath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "memory-lock-process-"))
  temporaryDirectories.push(directory)
  const counterPath = path.join(directory, "counter.txt")
  const logPath = path.join(directory, "critical.log")
  await writeFile(counterPath, "0\n")
  await writeFile(logPath, "")
  return { directory, lockPath: path.join(directory, "writer.lock"), counterPath, logPath }
}

afterEach(async () => {
  // Temp directories die only after every tracked child is confirmed exited: rm under a live
  // holder strands it, and a fire-and-forget SIGKILL is not a confirmation.
  const tracked = [...children]
  children.clear()
  for (const child of tracked) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    child.kill("SIGTERM")
    if (!(await exitedWithin(child, TEARDOWN_GRACE_MS))) {
      child.kill("SIGKILL")
      if (!(await exitedWithin(child, TEARDOWN_GRACE_MS))) {
        throw new Error(`tracked lock holder pid ${String(child.pid)} survived SIGTERM and SIGKILL teardown`)
      }
    }
  }
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }))
})

describe("real subprocess lock contention", () => {
  test("#given two Bun subprocess writers #when they contend on one counter #then critical-section log entries never interleave", async () => {
    // #given
    const fixture = await createFixture()
    const first = spawnWorker(["gated-increment", fixture.lockPath, fixture.counterPath, fixture.logPath, "first"])
    const firstExitPromise = waitForExit(first)
    await waitForOutput(first, "ready\n")
    const second = spawnWorker(["contending-increment", fixture.lockPath, fixture.counterPath, fixture.logPath, "second"])
    const secondExitPromise = waitForExit(second)
    await waitForOutput(second, "contended\n")

    // #when
    first.stdin.write("release\n")
    const [firstExit, secondExit] = await Promise.all([firstExitPromise, secondExitPromise])

    // #then
    expect(firstExit).toEqual({ code: 0, signal: null })
    expect(secondExit).toEqual({ code: 0, signal: null })
    expect(await readFile(fixture.counterPath, "utf8")).toBe("2\n")
    expect((await readFile(fixture.logPath, "utf8")).trim().split("\n")).toEqual([
      "first:enter", "first:exit", "second:enter", "second:exit",
    ])
  }, 10_000)

  test("#given a SIGKILLed Bun lock holder #when another process acquires #then proven-dead ownership is recovered", async () => {
    // #given
    const fixture = await createFixture()
    const holder = spawnWorker(["hold", fixture.lockPath, fixture.counterPath, fixture.logPath, "killed"])
    await waitForOutput(holder, "entered\n")
    const exitPromise = waitForExit(holder)

    // #when
    holder.kill("SIGKILL")
    const killed = await exitPromise
    const successor = await createLockRecord("memory-write", { runId: "successor" })
    await acquireLock(fixture.lockPath, successor, { waitTimeoutMs: 5_000, retryDelayMs: 10 })

    // #then
    expect(killed.signal).toBe("SIGKILL")
    expect(JSON.parse(await readFile(fixture.lockPath, "utf8"))).toEqual(successor)
    expect(await releaseLock(fixture.lockPath, successor)).toBe(true)
  }, 10_000)

  test("#given a live Bun lock holder #when a contender tries immediately #then the live owner is never stolen", async () => {
    // #given
    const fixture = await createFixture()
    const holder = spawnWorker(["hold", fixture.lockPath, fixture.counterPath, fixture.logPath, "live"])
    await waitForOutput(holder, "entered\n")
    const contender = await createLockRecord("memory-write", { runId: "contender" })

    // #when
    const error = await acquireLock(fixture.lockPath, contender).then(() => null, (cause: unknown) => cause)

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(JSON.parse(await readFile(fixture.lockPath, "utf8"))).toMatchObject({ run_id: "live" })
    const exitPromise = waitForExit(holder)
    holder.kill("SIGKILL")
    await exitPromise
  }, 10_000)
})

describe("subprocess lock holder lifecycle", () => {
  // A hold-mode worker must never outlive the parent that owns its stdin: an orphaned holder
  // parked on an unsettled top-level await busy-polls one core under Bun forever (#7335).

  test("#given a hold-mode worker that reported entered #when the parent ends its stdin #then the worker exits by itself within the bound", async () => {
    // #given
    const fixture = await createFixture()
    const holder = spawnWorker(["hold", fixture.lockPath, fixture.counterPath, fixture.logPath, "orphan"])
    try {
      await waitForOutput(holder, "entered\n")
      const exit = waitForExit(holder)

      // #when
      holder.stdin.end()

      // #then
      expect(await exit).toEqual({ code: 0, signal: null })
    } finally {
      await killAndAwait(holder)
    }
  }, 30_000)

  test("#given a wrapper that spawns the hold-mode worker and SIGKILLs itself once entered #when the wrapper dies #then the ORIGINAL worker is terminal within the bound", async () => {
    // #given: a wrapper that spawns the real worker with a wrapper-owned stdin pipe, records the
    // worker's own pid once it holds the lock, waits for this test to acknowledge that it has
    // snapshotted the worker's identity, then SIGKILLs itself. The test observes THAT original
    // worker (pid + command identity), never a substitute process.
    const fixture = await createFixture()
    const workerPidPath = path.join(fixture.directory, "worker.pid")
    const wrapperPath = path.join(fixture.directory, "abrupt-wrapper.mjs")
    await writeFile(wrapperPath, `
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const worker = spawn(
  process.execPath,
  [process.env.WORKER_PATH, "hold", process.env.LOCK_PATH, process.env.COUNTER_PATH, process.env.LOG_PATH, "abrupt"],
  { stdio: ["pipe", "pipe", "ignore"] },
)
let entered = false
let acknowledged = false
const dieOnceArmed = () => { if (entered && acknowledged) process.kill(process.pid, "SIGKILL") }
worker.stdout.on("data", (chunk) => {
  if (!chunk.toString().includes("entered\\n")) return
  writeFileSync(process.env.WORKER_PID_PATH, String(worker.pid))
  entered = true
  dieOnceArmed()
})
process.stdin.on("data", () => { acknowledged = true; dieOnceArmed() })
process.stdin.on("end", () => process.kill(process.pid, "SIGKILL"))
process.stdin.resume()
`, "utf8")
    const wrapper = track(spawn(process.execPath, [wrapperPath], {
      stdio: ["pipe", "ignore", "ignore"],
      env: {
        ...process.env,
        WORKER_PATH: workerPath,
        LOCK_PATH: fixture.lockPath,
        COUNTER_PATH: fixture.counterPath,
        LOG_PATH: fixture.logPath,
        WORKER_PID_PATH: workerPidPath,
      },
    }))
    // Subscribe to the wrapper's death BEFORE it can fire: the wrapper SIGKILLs itself in the
    // same tick it reads the acknowledgement, so listening only afterwards would miss the event.
    const wrapperExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("wrapper did not terminate after worker readiness")), READY_TIMEOUT_MS)
      wrapper.once("exit", (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
    })
    let workerIdentity: ProcessIdentity | null = null
    let workerPid: number | null = null
    try {
      workerPid = await readPidFileWhenWritten(workerPidPath, READY_TIMEOUT_MS)
      // The wrapper is still alive here (it dies only after our acknowledgement) and holds the
      // worker's stdin open, so the worker is alive too; the snapshot doubles as the fail-safe's
      // PID-reuse guard.
      workerIdentity = captureIdentity(workerPid)
      expect(workerIdentity).not.toBeNull()
      if (workerIdentity === null) throw new Error("unreachable")

      // #when
      wrapper.stdin?.write("ack\n")
      const exit = await wrapperExit
      // Windows reports no POSIX signal for a killed process: termination itself is the
      // contract, the signal is the POSIX-only corroboration.
      if (process.platform !== "win32") expect(exit.signal).toBe("SIGKILL")

      // #then: the ORIGINAL worker is terminal on every platform. Termination is awaited with a
      // zombie-aware liveness probe against the captured identity rather than asserted from a
      // single point-in-time probe, because the worker's death trails the wrapper's by a beat.
      expect(await pidTerminalWithin(workerIdentity, EXIT_TIMEOUT_MS)).toBe(true)
    } finally {
      await killAndAwait(wrapper)
      // Identity-guarded: never signal a pid that has since been reused by another process.
      if (workerIdentity !== null) killIfAlive(workerIdentity)
      else if (workerPid !== null && pidAlive(workerPid)) throw new Error(`worker pid ${String(workerPid)} is alive but its identity was never captured`)
    }
  }, 30_000)

  // The two tests below run back to back on purpose: the first leaves a live holder for the
  // file-level afterEach to tear down, the second observes what that teardown left behind.
  let teardownProbe: ChildProcessWithoutNullStreams | null = null

  test("#given a hold-mode worker still holding the lock when its test ends #when the test returns #then it is handed to afterEach", async () => {
    // #given
    const fixture = await createFixture()
    const holder = spawnWorker(["hold", fixture.lockPath, fixture.counterPath, fixture.logPath, "teardown"])
    await waitForOutput(holder, "entered\n")

    // #when: the test returns without killing the holder.
    teardownProbe = holder

    // #then
    expect(holder.exitCode).toBeNull()
    expect(holder.signalCode).toBeNull()
  }, 30_000)

  test("#given the holder handed to afterEach #when afterEach has run #then no tracked child remains alive", async () => {
    const holder = teardownProbe
    teardownProbe = null
    try {
      // #given
      expect(holder).not.toBeNull()
      if (holder === null) throw new Error("unreachable")

      // #then: teardown awaited the exit (exitCode or signalCode is set) and untracked the child
      // before this test started, so a subsequent rm can never strand a live holder.
      expect(holder.exitCode !== null || holder.signalCode !== null).toBe(true)
      expect(children.has(holder)).toBe(false)
    } finally {
      if (holder !== null) await killAndAwait(holder)
    }
  }, 30_000)
})
