import { describe, expect, test } from "bun:test"

import { spawn, spawnSync } from "./bun-spawn-shim"

describe("bun-spawn-shim", () => {
  test("#given array command #when spawn exits successfully #then exited resolves to zero", async () => {
    const proc = spawn(["bun", "--version"], { stdout: "pipe", stderr: "pipe" })

    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(proc.exitCode).toBe(0)
  })

  test("#given piped stdout #when spawn writes output #then stdout is readable", async () => {
    const proc = spawn(["bun", "--print", "'shim-ok'"], { stdout: "pipe", stderr: "pipe" })

    const [exitCode, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ])

    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe("shim-ok")
  })

  test("#given detached object command #when spawn starts #then process exposes daemon controls", async () => {
    const proc = spawn({
      cmd: ["bun", "--print", "'detached-ok'"],
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    })

    proc.unref()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(typeof proc.ref).toBe("function")
    expect(typeof proc.unref).toBe("function")
    expect(proc.pid).toBeGreaterThan(0)
  })

  test("#given stdio tuple #when spawn runs #then ignored streams are still safe to read", async () => {
    const proc = spawn({
      cmd: ["bun", "--print", "'ignored'"],
      stdio: ["ignore", "ignore", "ignore"],
    })

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()

    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  test("#given spawnSync command #when it writes output #then stdout and exit code match", () => {
    const result = spawnSync(["bun", "--print", "'sync-ok'"], { stdout: "pipe", stderr: "pipe" })

    expect(result.exitCode).toBe(0)
    expect(result.success).toBe(true)
    expect(result.stdout).toBeDefined()
    expect(Buffer.from(result.stdout!).toString().trim()).toBe("sync-ok")
  })

  test("#given spawnSync command #when it completes #then result.pid is a positive number", () => {
    const result = spawnSync(["bun", "--version"], { stdout: "pipe", stderr: "pipe" })

    expect(result.pid).toBeGreaterThan(0)
  })

  test("#given default stdio #when child reads stdin #then it does not hang waiting for input", async () => {
    const proc = spawn(["cat"], { stdout: "pipe", stderr: "pipe" })

    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
  })

  test("#given missing executable #when spawn invoked #then the error is surfaced to the caller", async () => {
    let observedError: unknown
    try {
      const proc = spawn(["__omo-shim-missing-binary__"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
    } catch (error) {
      observedError = error
    }

    expect(observedError).toBeDefined()
  })
})
