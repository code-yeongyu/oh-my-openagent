// Process-lifecycle regressions for the memory lock-holder fixture: a holder must be unable to
// outlive its parent's control pipe, so an aborted test run can never strand CPU-burning orphans
// holding marker locks (incident class: PPID-1 hold-lock processes spinning near 100% CPU).

import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { killIfAlive, pidTerminalWithin, readPidWhenWritten } from "./process-liveness.test-support"

const holdLockFixture = join(import.meta.dir, "__fixtures__", "hold-lock.ts")

const READY_TIMEOUT_MS = 10_000
const EXIT_BOUND_MS = 5_000
const FAILSAFE_BOUND_MS = 5_000

type ExitInfo = { readonly code: number | null; readonly signal: NodeJS.Signals | null }

/** Resolves with exit info once the child exits, or null after `boundMs` (never rejects). */
function exitInfoWithin(child: ChildProcess, boundMs: number): Promise<ExitInfo | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(null), boundMs)
    function settle(info: ExitInfo | null): void {
      clearTimeout(timer)
      child.off("exit", onExit)
      resolve(info)
    }
    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      settle({ code, signal })
    }
    child.once("exit", onExit)
  })
}

/** Resolves once the holder prints its readiness line; rejects on timeout or early exit. */
function readReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("lock holder never reported ready")), READY_TIMEOUT_MS)
    let output = ""
    function finish(error?: Error): void {
      clearTimeout(timer)
      child.stdout.off("data", onData)
      child.off("exit", onExit)
      error === undefined ? resolve() : reject(error)
    }
    function onData(chunk: Buffer): void {
      output += chunk.toString("utf8")
      if (output.includes("held\n")) finish()
    }
    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      finish(new Error(`lock holder exited early: code=${String(code)} signal=${String(signal)}`))
    }
    child.stdout.on("data", onData)
    child.once("exit", onExit)
  })
}

/** Polls a text marker written by a foreign writer; resolves with trimmed content once present. */
async function readMarkerWhenWritten(path: string, boundMs: number): Promise<string> {
  const deadline = Date.now() + boundMs
  for (;;) {
    try {
      return (await readFile(path, "utf8")).trim()
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    if (Date.now() >= deadline) throw new Error(`marker never appeared at ${path}`)
    await Bun.sleep(5)
  }
}

describe("hold-lock fixture lifecycle", () => {
  test("#given a hold-lock child holding its marker #when the parent-owned stdin pipe reports EOF #then the child exits within a bounded time", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-hold-lock-lifecycle-"))
    const child = spawn(process.execPath, [holdLockFixture, join(root, "finalize.lock")], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    try {
      await readReady(child)

      // when: teardown closes its end of the control pipe instead of signalling the child.
      child.stdin.destroy()

      // then
      const exit = await exitInfoWithin(child, EXIT_BOUND_MS)
      expect(exit).not.toBeNull()
    } finally {
      // Fail-safe: a failed assertion above must not leak the holder.
      child.kill("SIGKILL")
      await exitInfoWithin(child, FAILSAFE_BOUND_MS)
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  test("#given a wrapper killed abruptly only after its holder reported held #when no teardown can run #then the holder still exits within a bounded time", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-hold-lock-abrupt-"))
    const wrapperPath = join(root, "abrupt-wrapper.mjs")
    const holderPidPath = join(root, "holder.pid")
    const holderAliveAtDeathPath = join(root, "holder-alive-at-death.txt")
    await writeFile(wrapperPath, `
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const child = spawn(process.execPath, [process.env.HOLDER_FIXTURE, process.env.LOCK_PATH], { stdio: ["pipe", "pipe", "ignore"] })
let output = ""
child.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8")
  if (!output.includes("held\\n")) return
  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    writeFileSync(process.env.HOLDER_PID_PATH, String(child.pid))
    const stillRunning = child.exitCode === null && child.signalCode === null
    writeFileSync(process.env.HOLDER_ALIVE_PATH, stillRunning ? "alive" : "exited")
    process.kill(process.pid, "SIGKILL")
  })()
})
`, "utf8")
    const wrapper = spawn(process.execPath, [wrapperPath], {
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        HOLDER_FIXTURE: holdLockFixture,
        LOCK_PATH: join(root, "facts-runs.lock"),
        HOLDER_PID_PATH: holderPidPath,
        HOLDER_ALIVE_PATH: holderAliveAtDeathPath,
      },
    })
    let holderPid: number | undefined
    try {
      // when: the wrapper registers the holder's pid ONLY after observing the readiness line, so
      // the pid file's existence proves the marker lock was genuinely held when the wrapper then
      // self-SIGKILLs - no teardown can ever run, and the OS closing the wrapper's end of the
      // holder's stdin pipe is the only exit channel left.
      holderPid = await readPidWhenWritten(holderPidPath, READY_TIMEOUT_MS)
      const aliveAtWrapperDeath = await readMarkerWhenWritten(holderAliveAtDeathPath, READY_TIMEOUT_MS)

      // then: the holder was still PARKED (not self-exited) at the instant the wrapper died, so
      // its subsequent termination is attributable to the pipe EOF alone.
      expect(aliveAtWrapperDeath).toBe("alive")
      const holderGone = await pidTerminalWithin(holderPid, EXIT_BOUND_MS)
      expect(holderGone).toBe(true)
    } finally {
      // Fail-safe kills are attempted even when assertions failed; ESRCH races are fine.
      if (holderPid !== undefined) {
        killIfAlive(holderPid)
        await pidTerminalWithin(holderPid, FAILSAFE_BOUND_MS)
      }
      wrapper.kill("SIGKILL")
      await exitInfoWithin(wrapper, FAILSAFE_BOUND_MS)
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
