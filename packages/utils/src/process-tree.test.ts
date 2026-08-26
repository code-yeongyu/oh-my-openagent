import { describe, expect, it, test } from "bun:test"

import { runProcessWithTreeTimeout, type ProcessTreeTerminationReport } from "./process-tree"

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) throw error
    if (error.code === "ESRCH") return false
    throw error
  }
}

describe("runProcessWithTreeTimeout output decoding", () => {
  it("#given a UTF-8 character split across child writes #when output is collected #then the character is preserved", async () => {
    // given
    const script = [
      'const { writeSync } = require("node:fs")',
      "writeSync(1, Buffer.from([0xe2]))",
      "setImmediate(() => writeSync(1, Buffer.from([0x82, 0xac])))",
    ].join(";")

    // when
    const result = await runProcessWithTreeTimeout({
      args: ["--eval", script],
      command: process.execPath,
      cwd: process.cwd(),
      env: { PATH: process.env["PATH"] ?? "" },
      maxBuffer: 1024,
      timeoutMs: 5_000,
    })

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("€")
  })

  it("#given multibyte output exceeds the byte limit #when output is collected #then the process fails without partial text", async () => {
    // given
    const script = 'process.stdout.write("€")'

    // when
    const result = await runProcessWithTreeTimeout({
      args: ["--eval", script],
      command: process.execPath,
      cwd: process.cwd(),
      env: { PATH: process.env["PATH"] ?? "" },
      maxBuffer: 2,
      timeoutMs: 5_000,
    })

    // then
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
  })

  test.skipIf(process.platform === "win32")("#given a child and SIGTERM-resistant grandchild #when the command times out #then SIGKILL is observed and no process survives", async () => {
    // given
    const reports: ProcessTreeTerminationReport[] = []
    const grandchildScript = 'process.on("SIGTERM", () => undefined); setInterval(() => undefined, 1000)'
    const script = [
      'const { spawn } = require("node:child_process")',
      'process.on("SIGTERM", () => undefined)',
      `const grandchild = spawn(process.execPath, ["--eval", ${JSON.stringify(grandchildScript)}], { stdio: "ignore" })`,
      'process.stdout.write(`${process.pid} ${grandchild.pid}\\n`)',
      "setInterval(() => undefined, 1000)",
    ].join(";")

    // when
    const result = await runProcessWithTreeTimeout({
      args: ["--eval", script],
      command: process.execPath,
      cwd: process.cwd(),
      env: { PATH: process.env["PATH"] ?? "" },
      maxBuffer: 1024,
      onTerminationReport: (report) => reports.push(report),
      terminationGraceMs: 50,
      terminationWaitMs: 1_000,
      timeoutMs: 1_000,
    })
    const pids = result.stdout.trim().split(/\s+/).map(Number)

    // then
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(124)
    expect(pids).toHaveLength(2)
    expect(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0)).toBe(true)
    expect(pids.some(isProcessAlive)).toBe(false)
    expect(result.termination?.survivorPids).toEqual([])
    expect(result.termination?.attempts.some((attempt) => attempt.signal === "SIGKILL")).toBe(true)
    expect(reports).toEqual([result.termination])
  })
})
