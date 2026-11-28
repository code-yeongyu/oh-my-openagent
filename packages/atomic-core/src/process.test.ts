import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, watch } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type AtomicSpawnRequest, spawnAtomicProcess } from "./index"
import { ATOMIC_OUTPUT_LIMIT_BYTES } from "./process"

const environment = { PATH: process.env["PATH"] ?? "" }
const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function script(source: string, overrides: Partial<AtomicSpawnRequest> = {}): AtomicSpawnRequest {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: tmpdir(),
    environment,
    timeoutMs: 10_000,
    outputLimitBytes: ATOMIC_OUTPUT_LIMIT_BYTES,
    ...overrides,
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("spawnAtomicProcess", () => {
  test("#given a child filling both pipes #when it runs #then stdout and stderr are drained concurrently", async () => {
    // given
    const source = "const c='x'.repeat(65536);for(let i=0;i<16;i++){process.stderr.write(c);process.stdout.write(c)}"

    // when
    const outcome = await spawnAtomicProcess(script(source))

    // then
    expect(outcome.kind).toBe("exited")
    if (outcome.kind !== "exited") return
    expect(outcome.stdout.length).toBe(1024 * 1024)
    expect(outcome.stderr.length).toBe(1024 * 1024)
  })

  test("#given output beyond the cap #when it runs #then the process is stopped and output_limit names the stream", async () => {
    // given
    const source = "const c='y'.repeat(1048576);for(let i=0;i<3;i++)process.stderr.write(c);setInterval(()=>{},1000)"

    // when
    const outcome = await spawnAtomicProcess(script(source))

    // then
    expect(outcome).toEqual({ kind: "output_limit", stream: "stderr" })
  })

  test("#given hostile arguments and a cwd with spaces #when spawned #then no shell interprets them", async () => {
    // given
    const cwd = makeTempDir("atomic core dir ")
    const hostile = ["$(touch pwned)", "a; touch pwned", "*", "'quoted' \"x\"", "-- --json", "| cat"]
    const source = "process.stdout.write(JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd()}))"

    // when
    const outcome = await spawnAtomicProcess(script(source, { args: ["-e", source, ...hostile], cwd }))

    // then
    expect(outcome.kind).toBe("exited")
    if (outcome.kind !== "exited") return
    const report: unknown = JSON.parse(outcome.stdout)
    expect(report).toEqual({ argv: hostile, cwd: expect.stringContaining("atomic core dir ") })
    expect(existsSync(join(cwd, "pwned"))).toBe(false)
  })

  test("#given stdin #when spawned #then the child reads the exact bytes", async () => {
    // given
    const payload = JSON.stringify({ session_id: "ses_fixture", prompt: "line one\nline two" })

    // when
    const outcome = await spawnAtomicProcess(script("process.stdin.pipe(process.stdout)", { stdin: payload }))

    // then
    expect(outcome).toEqual({ kind: "exited", exitCode: 0, stdout: payload, stderr: "" })
  })

  test("#given a missing executable #when spawned #then spawn_failed carries ENOENT", async () => {
    // given
    const request = script("", { executable: join(tmpdir(), "atomic-core-missing-binary") })

    // when
    const outcome = await spawnAtomicProcess(request)

    // then
    expect(outcome.kind).toBe("spawn_failed")
    if (outcome.kind !== "spawn_failed") return
    expect(outcome.errorCode).toBe("ENOENT")
  })

  test("#given a child that never exits #when the timeout fires #then it resolves only after the child is gone", async () => {
    // given
    const dir = makeTempDir("atomic-core-timeout-")
    const pidFile = join(dir, "pid")
    const source = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(()=>{},1000)`

    // when
    const outcome = await spawnAtomicProcess(script(source, { timeoutMs: 300 }))

    // then
    expect(outcome).toEqual({ kind: "timeout" })
    if (existsSync(pidFile)) expect(isAlive(Number(readFileSync(pidFile, "utf8")))).toBe(false)
  })

  test("#given a child ignoring SIGTERM #when aborted #then termination escalates to SIGKILL before resolving", async () => {
    // given
    const dir = makeTempDir("atomic-core-abort-")
    const pidFile = join(dir, "pid")
    const termFile = join(dir, "term")
    const source = [
      `process.on("SIGTERM",()=>require("fs").writeFileSync(${JSON.stringify(termFile)},"term"))`,
      `require("fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid))`,
      "setInterval(()=>{},1000)",
    ].join(";")
    const controller = new AbortController()
    const watcher = watch(dir, (_event, name) => {
      if (name === "pid") controller.abort()
    })

    // when
    const outcome = await spawnAtomicProcess(script(source, { signal: controller.signal }))
    watcher.close()

    // then
    expect(outcome).toEqual({ kind: "cancelled" })
    expect(readFileSync(termFile, "utf8")).toBe("term")
    expect(isAlive(Number(readFileSync(pidFile, "utf8")))).toBe(false)
  })

  test("#given an already aborted signal #when called #then nothing is spawned", async () => {
    // given
    const controller = new AbortController()
    controller.abort()
    const request = script("", { executable: join(tmpdir(), "atomic-core-missing-binary"), signal: controller.signal })

    // when
    const outcome = await spawnAtomicProcess(request)

    // then
    expect(outcome).toEqual({ kind: "cancelled" })
  })
})
