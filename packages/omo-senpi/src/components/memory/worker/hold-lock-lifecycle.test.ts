import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import type { Server, Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { captureIdentity, killIfAlive, pidAlive, pidTerminalWithin, readPidFileWhenWritten, waitForFileToExist } from "./process-liveness.test-support"

const holdLockFixture = join(import.meta.dir, "__fixtures__", "hold-lock.ts")
const READY_TIMEOUT_MS = 10_000
const EXIT_TIMEOUT_MS = 5_000

type ExitInfo = { readonly code: number | null; readonly signal: NodeJS.Signals | null }

function exitWithin(child: ChildProcess, boundMs: number): Promise<ExitInfo> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child ${String(child.pid)} did not exit within ${boundMs}ms`)), boundMs)
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
  })
}

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("lock holder never reported ready")), READY_TIMEOUT_MS)
    let output = ""
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8")
      if (!output.includes("held\n")) return
      clearTimeout(timer)
      child.stdout.off("data", onData)
      resolve()
    }
    child.stdout.on("data", onData)
    child.once("exit", () => reject(new Error("lock holder exited before readiness")))
  })
}

function listenOnLoopback(control: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    control.once("error", reject)
    control.listen(0, "127.0.0.1", () => {
      const address = control.address()
      if (address === null || typeof address === "string") return reject(new Error("control listener has no tcp port"))
      resolve(address.port)
    })
  })
}

describe("hold-lock fixture lifecycle", () => {
  test("exits on the parent-owned stdin EOF event", async () => {
    const root = await mkdtemp(join(tmpdir(), "omo-hold-lock-lifecycle-"))
    const child = spawn(process.execPath, [holdLockFixture, join(root, "finalize.lock")], { stdio: ["pipe", "pipe", "pipe"] })
    try {
      await waitForReady(child)
      const exit = exitWithin(child, EXIT_TIMEOUT_MS)
      child.stdin.end()
      expect((await exit).signal).toBeNull()
    } finally {
      child.kill("SIGKILL")
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  test("exits when ONLY the parent-owned control channel closes while stdin stays open", async () => {
    // given: a holder whose stdin never closes; the fixture's CONTROL_PORT branch is the only
    // possible exit path, so a fixture without it (origin/dev) can never produce the marker.
    const root = await mkdtemp(join(tmpdir(), "omo-hold-lock-control-"))
    const marker = join(root, "holder-exited.marker")
    const control = createServer()
    const connections = new Set<Socket>()
    control.on("connection", (socket) => connections.add(socket))
    const port = await listenOnLoopback(control)
    const child = spawn(process.execPath, [holdLockFixture, join(root, "control.lock")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CONTROL_PORT: String(port), EXIT_MARKER: marker },
    })
    try {
      await waitForReady(child)
      const exit = exitWithin(child, EXIT_TIMEOUT_MS)

      // when
      for (const socket of connections) socket.destroy()
      control.close()

      // then: the child's own exit is the terminal event; the fixture writes the marker before
      // releasing its parking promise, so the marker is on disk once the exit lands.
      expect((await exit).signal).toBeNull()
      expect(existsSync(marker)).toBe(true)
    } finally {
      child.kill("SIGKILL")
      control.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  test("an abruptly killed wrapper takes the ORIGINAL holder down with it", async () => {
    // given: a wrapper that spawns the real holder, records the holder's own pid, then SIGKILLs
    // itself; the test observes THAT original holder (pid identity + exit marker + terminal
    // state), never a substitute process.
    const root = await mkdtemp(join(tmpdir(), "omo-hold-lock-abrupt-"))
    const holderPidPath = join(root, "holder.pid")
    const marker = join(root, "holder-exited.marker")
    const wrapperPath = join(root, "abrupt-wrapper.mjs")
    await writeFile(wrapperPath, `
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const child = spawn(process.execPath, [process.env.HOLDER_FIXTURE, process.env.LOCK_PATH], { stdio: ["pipe", "pipe", "ignore"] })
child.stdout.on("data", (chunk) => {
  if (!chunk.toString().includes("held\\n")) return
  writeFileSync(process.env.HOLDER_PID_PATH, String(child.pid))
  process.kill(process.pid, "SIGKILL")
})
`, "utf8")
    const wrapper = spawn(process.execPath, [wrapperPath], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, HOLDER_FIXTURE: holdLockFixture, LOCK_PATH: join(root, "facts-runs.lock"), HOLDER_PID_PATH: holderPidPath, EXIT_MARKER: marker },
    })
    // Subscribe to the wrapper's death BEFORE it can fire: the wrapper SIGKILLs itself in the
    // same tick it writes the pid file, so listening only after the read would miss the event.
    const wrapperExit = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("wrapper did not terminate after holder readiness")), READY_TIMEOUT_MS)
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        clearTimeout(timer)
        try {
          // Windows reports no POSIX signal for a killed process: termination itself is the
          // contract, the signal is the POSIX-only corroboration.
          if (process.platform === "win32") expect(code === null || typeof code === "number").toBe(true)
          else expect(signal).toBe("SIGKILL")
          resolve()
        } catch (error) {
          reject(error as Error)
        }
      }
      if (wrapper.exitCode !== null || wrapper.signalCode !== null) { onExit(wrapper.exitCode, wrapper.signalCode); return }
      wrapper.once("exit", onExit)
    })
    let holderIdentityForCleanup: import("./process-liveness.test-support").ProcessIdentity | null = null
    try {
      const holderPid = await readPidFileWhenWritten(holderPidPath, READY_TIMEOUT_MS)
      // The holder is alive at this point (the wrapper dies only after writing the pid file), so
      // the identity snapshot doubles as the fail-safe's PID-reuse guard.
      holderIdentityForCleanup = captureIdentity(holderPid)

      // when
      await wrapperExit

      // then: the ORIGINAL holder is terminal. Termination is awaited event-first (a zombie-aware
      // liveness probe against the captured identity) instead of being asserted from a single
      // point-in-time probe, because the holder's death trails the wrapper's by a beat.
      if (holderIdentityForCleanup !== null) {
        expect(await pidTerminalWithin(holderIdentityForCleanup, EXIT_TIMEOUT_MS)).toBe(true)
      } else {
        expect(pidAlive(holderPid)).toBe(false)
      }
      // and then (POSIX only): the holder observed its own ownership loss and shut down through
      // its stdin-EOF path, which is what writes the marker. Windows tears the whole tree down
      // with the wrapper, so the holder never gets to run that handler - the marker is a
      // graceful-shutdown observable there, not a termination one.
      if (process.platform !== "win32") expect(await waitForFileToExist(marker, EXIT_TIMEOUT_MS)).toBe(true)
    } finally {
      wrapper.kill("SIGKILL")
      if (holderIdentityForCleanup !== null) killIfAlive(holderIdentityForCleanup)
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
