import { afterEach, describe, expect, test } from "bun:test"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { LockContentionError, acquireLock, createLockRecord, releaseLock } from "./index"

const workerPath = fileURLToPath(new URL("./subprocess-worker.ts", import.meta.url))
const temporaryDirectories: string[] = []
const children = new Set<ChildProcessWithoutNullStreams>()

function spawnWorker(args: string[]): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [workerPath, ...args], { stdio: ["pipe", "pipe", "pipe"] })
  children.add(child)
  child.once("exit", () => children.delete(child))
  return child
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
  for (const child of children) child.kill("SIGKILL")
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
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
