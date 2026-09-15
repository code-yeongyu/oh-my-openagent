// TEMPORARY DIAGNOSTIC for #8294 - never merged. Measures, on the real Windows runner:
//  (a) what getPidLiveness reports for a SIGKILLed Bun child right after the parent's `exit` event,
//  (b) the latency and null-rate of the PowerShell start-identity probe for a live foreign pid,
//  (c) the cost of repeated own-pid createLockRecord calls (memoization vs null re-probe),
//  (d) whether Bun's fs.rm honours maxRetries/retryDelay on a Windows EBUSY.
import { describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLockRecord, getPidLiveness, getProcessStartIdentity } from "../locks"

const onWin32 = process.platform === "win32"

function report(kind: string, payload: Record<string, unknown>): void {
  console.log(`DIAG ${JSON.stringify({ kind, ...payload })}`)
}

function spawnBun(script: string, args: readonly string[] = []): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["-e", script, ...args], { stdio: ["pipe", "pipe", "pipe"] })
}

function waitForStdoutLine(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk
      if (buffer.split(/\r?\n/).includes(expected)) resolve()
    })
    child.once("exit", (code, signal) => reject(new Error(`child exited before ${expected}: ${String(code)} ${String(signal)}`)))
  })
}

function exitOf(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
}

const SLEEPER = "console.log('ready'); setTimeout(() => {}, 120000)"

describe("win32 probe diagnostic (#8294)", () => {
  test.if(onWin32)("(a) liveness of a SIGKILLed child right after the parent's exit event", async () => {
    for (let round = 0; round < 8; round += 1) {
      const child = spawnBun(SLEEPER)
      await waitForStdoutLine(child, "ready")
      const pid = child.pid as number
      const beforeKill = getPidLiveness(pid)
      const exited = exitOf(child)
      child.kill("SIGKILL")
      const exit = await exited
      const atExit = getPidLiveness(pid)
      const started = performance.now()
      let probes = 1
      let current = atExit
      while (current !== "dead" && performance.now() - started < 5_000) {
        await new Promise((resolve) => setTimeout(resolve, 1))
        current = getPidLiveness(pid)
        probes += 1
      }
      report("liveness-after-exit", { round, pid, beforeKill, exit, atExit, settled: current, msUntilDead: Math.round((performance.now() - started) * 100) / 100, probes })
    }
    expect(true).toBe(true)
  }, 60_000)

  test.if(onWin32)("(b) PowerShell start-identity probe latency for a live foreign pid", async () => {
    const child = spawnBun(SLEEPER)
    await waitForStdoutLine(child, "ready")
    const pid = child.pid as number
    try {
      for (let round = 0; round < 6; round += 1) {
        const started = performance.now()
        const identity = await getProcessStartIdentity(pid)
        report("foreign-probe", { round, pid, ms: Math.round(performance.now() - started), identity })
      }
    } finally {
      child.kill("SIGKILL")
      await exitOf(child)
    }
    expect(true).toBe(true)
  }, 60_000)

  test.if(onWin32)("(c) repeated own-pid createLockRecord cost", async () => {
    for (let round = 0; round < 6; round += 1) {
      const started = performance.now()
      const record = await createLockRecord("diagnostic")
      report("own-lock-record", { round, ms: Math.round(performance.now() - started), process_start: record.process_start })
    }
    expect(true).toBe(true)
  }, 60_000)

  test.if(onWin32)("(d) fs.rm maxRetries/retryDelay against a Windows EBUSY", async () => {
    const root = await mkdtemp(join(tmpdir(), "memory-diag-rm-"))
    const held = join(root, "held.txt")
    await writeFile(held, "held")
    const holder = spawnBun("const fd = require('node:fs').openSync(process.argv[1], 'r'); console.log('ready'); setTimeout(() => {}, 120000)", [held])
    await waitForStdoutLine(holder, "ready")
    try {
      const started = performance.now()
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        report("rm-while-held", { outcome: "removed", ms: Math.round(performance.now() - started) })
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "unknown"
        report("rm-while-held", { outcome: "threw", code, ms: Math.round(performance.now() - started), nodeWouldWaitMs: 200 * 55 })
      }
    } finally {
      holder.kill("SIGKILL")
      await exitOf(holder)
    }
    const started = performance.now()
    let attempts = 0
    for (;;) {
      attempts += 1
      try {
        await rm(root, { recursive: true, force: true })
        break
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "unknown"
        if (performance.now() - started > 10_000) throw error
        report("rm-after-kill-retry", { attempts, code, ms: Math.round(performance.now() - started) })
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    report("rm-after-kill", { attempts, ms: Math.round(performance.now() - started) })
    expect(true).toBe(true)
  }, 60_000)
})
