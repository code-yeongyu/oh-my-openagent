import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

import { createHash } from "node:crypto"

import { decideReflectionLock, formatReflectionLockLines, reflectionLockFix, reflectionLockReport } from "../bin/lib/doctor-reflection-lock.js"
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

const NOW = Date.parse("2026-11-05T06:00:00.000Z")

function launchInterrupted(reflectionDir: string): void {
  write(join(reflectionDir, "active.lock"), {
    runId: "reflection-run-64", request: { trigger: "manual", conversationIds: [], snapshots: [] },
    reservedAt: new Date(NOW - 10 * 60_000).toISOString(), launcherPid: 11096, launcherHostname: HOST, launcherProcessStart: null,
  })
}

function treeHash(root: string): string {
  const hash = createHash("sha256")
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      hash.update(relative(root, path))
      if (entry.isDirectory()) walk(path)
      else hash.update(readFileSync(path))
    }
  }
  walk(root)
  return hash.digest("hex")
}

describe("omo doctor --fix reflection locks (#11976)", () => {
  const fixProbe = { ...probe("dead"), now: () => NOW }

  test("#given a launcher that died before its run started #when --fix runs #then the lock is released and the line names the identity, the run and the action", async () => {
    const root = memoryHome()
    const reflectionDir = identity(root, "agent-a")
    launchInterrupted(reflectionDir)
    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: fixProbe })
    expect(result.failed).toBe(false)
    expect(result.lines).toContain("FIXED agent-a active.lock run reflection-run-64 (launch-interrupted)")
    expect(existsSync(join(reflectionDir, "active.lock"))).toBe(false)
    expect(existsSync(join(reflectionDir, "runs", "reflection-run-64", "abandoned.json"))).toBe(true)
  })

  test("#given case A, case C and case E on three identities #when --fix --dry-run runs #then it prints the three decisions and changes nothing", async () => {
    const root = memoryHome()
    launchInterrupted(identity(root, "agent-a"))
    const c = identity(root, "agent-c")
    launchInterrupted(c)
    write(join(c, "runs", "reflection-run-64", "ledger.json"), "{ torn")
    write(join(identity(root, "agent-e"), "active.lock"), "{\"runId\":")
    utimesSync(join(identity(root, "agent-e"), "active.lock"), new Date(NOW - 2 * 60 * 60_000), new Date(NOW - 2 * 60 * 60_000))
    const before = treeHash(root)
    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: fixProbe, dryRun: true })
    expect(result.lines).toEqual(expect.arrayContaining([
      "WOULD FIX agent-a active.lock run reflection-run-64 (launch-interrupted)",
      "WOULD FIX agent-c active.lock run reflection-run-64 (ledger-unreadable)",
      "WOULD FIX agent-e active.lock run unknown (lock-torn)",
    ]))
    expect(treeHash(root)).toBe(before)
  })

  test("#given an identity with a runtime/ but no repo/ holding a dead launcher's lock and a dead sidecar owner lock #when --fix runs #then both are released (C27)", async () => {
    const root = memoryHome()
    const reflectionDir = identity(root, "agent-norepo", false)
    launchInterrupted(reflectionDir)
    write(join(reflectionDir, "..", "locks", "recall-sidecar.y.lock"), { pid: 2147483646, process_start: "gone", hostname: hostname(), nonce: "n", created_at: new Date(NOW).toISOString(), purpose: "recall-sidecar" })
    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: fixProbe })
    expect(result.lines).toContain("FIXED agent-norepo active.lock run reflection-run-64 (launch-interrupted)")
    expect(existsSync(join(reflectionDir, "active.lock"))).toBe(false)
    expect(existsSync(join(reflectionDir, "..", "locks", "recall-sidecar.y.lock"))).toBe(false)
  })

  test("#given a repo identity with a stray worktree dir of a quarantined run past the grace window and one of a live run #when --fix runs (and --dry-run before it) #then the stray goes, the live one stays with its reason (C28)", async () => {
    const root = memoryHome()
    const reflectionDir = identity(root, "agent-git")
    const repo = join(reflectionDir, "..", "..", "repo")
    expect(Bun.spawnSync(["git", "init", "-q", repo]).exitCode).toBe(0)
    const worktrees = join(reflectionDir, "..", "worktrees")
    const old = NOW - 60 * 60_000
    write(join(reflectionDir, "runs", "reflection-run-7", "quarantined.json"), { version: 1, runId: "reflection-run-7" })
    write(join(worktrees, `${old}-reflection-run-7`, "file"), "x")
    write(join(reflectionDir, "runs", "reflection-run-8", "prelaunch.json"), { runId: "reflection-run-8" })
    utimesSync(join(reflectionDir, "runs", "reflection-run-8", "prelaunch.json"), new Date(NOW), new Date(NOW))
    write(join(worktrees, `${old}-reflection-run-8`, "file"), "x")
    const dry = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: fixProbe, dryRun: true })
    expect(dry.lines).toEqual(expect.arrayContaining([
      `WOULD FIX agent-git removed orphan ${join(worktrees, `${old}-reflection-run-7`)}`,
      `KEPT agent-git worktree ${join(worktrees, `${old}-reflection-run-8`)} (live)`,
    ]))
    expect(existsSync(join(worktrees, `${old}-reflection-run-7`))).toBe(true)
    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: fixProbe })
    expect(result.lines).toContain(`FIXED agent-git removed orphan ${join(worktrees, `${old}-reflection-run-7`)}`)
    expect(existsSync(join(worktrees, `${old}-reflection-run-7`))).toBe(false)
    expect(existsSync(join(worktrees, `${old}-reflection-run-8`))).toBe(true)
  })

  test("#given an other-host lock, a live launcher and a torn lock beside a live run, each with a reapable sibling #when --fix runs #then only the siblings are released (C05, C07, C09 positive controls)", async () => {
    const root = memoryHome()
    const other = identity(root, "agent-d")
    write(join(other, "active.lock"), { runId: "reflection-run-64", request: { trigger: "manual", conversationIds: [], snapshots: [] }, reservedAt: new Date(NOW - 10 * 60_000).toISOString(), launcherPid: 11096, launcherHostname: "other-host", launcherProcessStart: null })
    const live = identity(root, "agent-live")
    write(join(live, "active.lock"), { runId: "reflection-run-64", request: { trigger: "manual", conversationIds: [], snapshots: [] }, reservedAt: new Date(NOW - 10 * 60_000).toISOString(), launcherPid: 4242, launcherHostname: HOST, launcherProcessStart: null })
    const torn = identity(root, "agent-torn")
    write(join(torn, "active.lock"), "{\"runId\":")
    utimesSync(join(torn, "active.lock"), new Date(NOW - 2 * 60 * 60_000), new Date(NOW - 2 * 60 * 60_000))
    write(join(torn, "runs", "reflection-run-63", "ledger.json"), { version: 1, runId: "reflection-run-63", pid: 4243, processStart: "s" })
    utimesSync(join(torn, "runs", "reflection-run-63"), new Date(NOW - 2 * 60 * 60_000), new Date(NOW - 2 * 60 * 60_000))
    const sibling = identity(root, "agent-sibling")
    launchInterrupted(sibling)
    const pids: Record<number, "alive" | "dead"> = { 4242: "alive", 4243: "alive" }
    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: { hostname: () => HOST, now: () => NOW, getPidLiveness: (pid: number) => pids[pid] ?? "dead", getProcessStartIdentity: async () => "s" } })
    expect(existsSync(join(other, "active.lock"))).toBe(true)
    expect(existsSync(join(live, "active.lock"))).toBe(true)
    expect(existsSync(join(torn, "active.lock"))).toBe(true)
    expect(existsSync(join(sibling, "active.lock"))).toBe(false)
    expect(result.lines).toContain("FIXED agent-sibling active.lock run reflection-run-64 (launch-interrupted)")
  })

  test("#given a runtime lock whose owner pid is gone #when --fix runs #then the lock is reclaimed and counted", async () => {
    const root = memoryHome()
    const reflectionDir = identity(root, "agent-a")
    const locks = join(reflectionDir, "..", "locks")
    write(join(locks, "recall-sidecar.x.lock"), { pid: 2147483646, process_start: "gone", hostname: hostname(), nonce: "n", created_at: new Date(NOW).toISOString(), purpose: "recall-sidecar" })
    const result = await reflectionLockFix({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: fixProbe })
    expect(result.lines).toContain("INFO agent-a locks reclaimed 1, kept 0")
    expect(existsSync(join(locks, "recall-sidecar.x.lock"))).toBe(false)
  })
})

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

  test("#given a launcher that died before its run started (#11976 case A) #when the report runs without --fix #then the decision is a launch-interrupted reap and a line is printed (C14)", async () => {
    const root = memoryHome()
    const reflectionDir = identity(root, "agent-a")
    launchInterrupted(reflectionDir)
    const fixProbe = { ...probe("dead"), now: () => NOW }
    const { decision } = await decideReflectionLock(reflectionDir, fixProbe)
    const lines = await reflectionLockReport({ env: { OMO_MEMORY_HOME: root }, reflectionLockProbe: fixProbe })
    expect(decision).toMatchObject({ kind: "reap", action: "launch-interrupted" })
    expect(lines).toHaveLength(1)
    expect(lines[0]?.length).toBeGreaterThan(0)
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
