import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { formatReflectionLockLines, reflectionLockFix, reflectionLockReport } from "../bin/lib/doctor-reflection-lock.js"
import { runDoctor } from "../bin/lib/doctor.js"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const HOST = "this-host"

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content))
}

function memoryHome(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-doctor-reflection-lock-"))
  roots.push(root)
  return root
}

function identity(root: string, id: string, durable = true): string {
  const identityRoot = join(root, "agents", id)
  mkdirSync(identityRoot, { recursive: true })
  if (durable) mkdirSync(join(identityRoot, "repo"), { recursive: true })
  return join(identityRoot, "runtime", "reflection")
}

function deadHolder(reflectionDir: string): void {
  write(join(reflectionDir, "active.lock"), { runId: "reflection-run-64", launcherPid: 11096, launcherHostname: HOST })
  write(join(reflectionDir, "runs", "reflection-run-64", "outcome.json"), { version: 1, runId: "reflection-run-64", attempt: 1, finishedAt: "2026-10-17T00:00:00.000Z", childExit: { code: 0, signal: null }, timedOut: false })
}

test("#given an outcome.json that is not valid JSON on disk #when the report runs #then the holder is reported stuck with that reason", async () => {
  const root = memoryHome()
  const reflectionDir = identity(root, "agent-a")
  deadHolder(reflectionDir)
  write(join(reflectionDir, "runs", "reflection-run-64", "outcome.json"), "{\"version\": 1, \"runId\": ")
  const [line] = await reflectionLockReport({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: { getPidLiveness: () => "dead", hostname: () => HOST } })
  expect(line).toContain("its outcome is not valid JSON")
  expect(line).toContain("Next step: run /doctor in a session")
})

const probe = (liveness: "alive" | "dead" | "unknown") => ({ getPidLiveness: () => liveness, hostname: () => HOST })

// The rules themselves are pinned by the shared decision's tests (memory-core stale-holder.test.ts)
// and the session/CLI parity test; these cover the report surface.
describe("omo doctor reflection lock report (#10377)", () => {
  test("#given a dead holder on disk #when the report runs #then it names the run and the next step", async () => {
    const root = memoryHome()
    deadHolder(identity(root, "agent-a"))
    const lines = await reflectionLockReport({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: probe("dead") })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith("WARN memory reflection is stuck on a stale lock (agent-a): run reflection-run-64")
    expect(lines[0]).toContain("Next step: open a session and send /reflect")
  })

  test("#given a holder whose liveness cannot be checked #when the report runs #then it shows the reason and the next step", async () => {
    const root = memoryHome()
    deadHolder(identity(root, "agent-a"))
    const [line] = await reflectionLockReport({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: probe("unknown") })
    expect(line).toContain("launcher pid 11096 could not be checked")
    expect(line).toContain("Next step: run /doctor in a session")
  })

  test("#given a live holder #when the report runs #then it prints nothing", async () => {
    const root = memoryHome()
    deadHolder(identity(root, "agent-a"))
    expect(await reflectionLockReport({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: probe("alive") })).toEqual([])
  })

  test("#given a stuck durable identity and a stuck transient one #when the report runs #then only the durable one is reported", async () => {
    const root = memoryHome()
    deadHolder(identity(root, "agent-a"))
    deadHolder(identity(root, "transient-x", false))
    const lines = await reflectionLockReport({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: probe("unknown") })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("(agent-a)")
  })

  test("#given no memory home on disk #when the report runs #then it prints nothing", async () => {
    expect(await reflectionLockReport({ env: { OMO_MEMORY_HOME: join(memoryHome(), "missing") } })).toEqual([])
  })

  test("#given no lock #when formatted #then nothing is printed", () => {
    expect(formatReflectionLockLines("agent-a", { state: "none" }, "/x")).toEqual([])
  })

  test("#given precomputed report lines #when omo doctor runs #then it prints them", () => {
    const logged: string[] = []
    const original = console.log
    const originalExitCode = process.exitCode
    console.log = (...args: unknown[]) => { logged.push(args.join(" ")) }
    try {
      runDoctor({ harnesses: [] }, [], { list: () => [], fetchDistTags: () => null, daemonReport: () => [], reflectionLock: ["WARN memory reflection is stuck on a stale lock (agent-a)"] })
    } finally {
      console.log = original
      process.exitCode = originalExitCode ?? 0
    }
    expect(logged.join("\n")).toContain("WARN memory reflection is stuck on a stale lock (agent-a)")
  })
})

async function killedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], { stdio: "ignore" })
  const pid = child.pid
  if (pid === undefined) throw new Error("child did not start")
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill("SIGKILL")
  await exited
  return pid
}

function holder(reflectionDir: string, launcherPid: number): string {
  const lock = join(reflectionDir, "active.lock")
  write(lock, { runId: "reflection-run-7", request: { trigger: "manual", conversationIds: [], snapshots: [] }, reservedAt: new Date(Date.now() - 10 * 60_000).toISOString(), launcherPid, launcherHostname: hostname() })
  return lock
}

describe("omo doctor --fix reaps a stale reflection lock (#11976)", () => {
  test("#given a launcher killed with SIGKILL #when plain omo doctor reports #then it points at --fix and leaves the lock", async () => {
    const root = memoryHome()
    const lock = holder(identity(root, "agent-a"), await killedPid())
    const lines = await reflectionLockReport({ env: { OMO_MEMORY_HOME: root } })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("omo doctor --fix")
    expect(existsSync(lock)).toBe(true)
  })

  test("#given dead and live holders across identities #when omo doctor --fix runs #then only the dead one is moved aside", async () => {
    const root = memoryHome()
    const dead = holder(identity(root, "agent-dead"), await killedPid())
    const live = holder(identity(root, "agent-live"), process.pid)
    const lines = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root } })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith("PASS reaped a stale reflection lock (agent-dead): run reflection-run-7")
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(join(dirname(dead), "reaped"))).toBe(true)
    expect(existsSync(live)).toBe(true)
  })
})
