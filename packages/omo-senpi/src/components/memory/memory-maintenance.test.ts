import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_RUNTIME_RETENTION,
  GitMemoryRepo,
  TranscriptJournal,
  buildIdentityPaths,
  createLockRecord,
  memoryMaintenanceLockPath,
  reflectionSchedulerLockPath,
  withLock,
} from "@oh-my-opencode/memory-core"

import { OmoMemorySettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { createMemoryMaintenance } from "./memory-maintenance"
import { rmEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function identityWithHistory(commits: number) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-maintenance-")))
  roots.push(root)
  const identity = "maintained-agent"
  const identityPaths = buildIdentityPaths(root, identity)
  const context = createMemoryIdentityContext({
    identity,
    identityPaths,
    binding: createMemoryBinding({ identity, repoPath: identityPaths.repo, boundAt: 1 }),
  })
  const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: identity })
  await repo.init()
  for (let index = 0; index < commits; index += 1) {
    await writeFile(join(repo.dir, `note-${index}.md`), `note ${index}\n`)
    await repo.commitWrite([`note-${index}.md`], `note ${index}`, { agentId: identity, authorName: identity })
  }
  return { context, repo }
}

function looseObjects(dir: string): number {
  const output = execFileSync("git", ["count-objects", "-v"], { cwd: dir, encoding: "utf8" })
  return Number(/^count: (\d+)$/m.exec(output)?.[1] ?? Number.NaN)
}

function recorder() {
  const info: string[] = []
  const infoData: { message: string; data?: Record<string, unknown> }[] = []
  const warn: string[] = []
  return {
    info,
    infoData,
    warn,
    logger: {
      info: (message: string, data?: Record<string, unknown>) => {
        info.push(message)
        infoData.push({ message, ...(data === undefined ? {} : { data }) })
      },
      warn: (message: string) => warn.push(message),
    },
  }
}

describe("createMemoryMaintenance", () => {
  test("#given a memory repo full of loose objects #when a session binds and the delay passes #then the objects are packed and every commit stays readable", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const before = looseObjects(repo.dir)
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, minLooseObjects: 10 })

    // when
    maintenance.schedule(context)
    await maintenance.settled()

    // then
    expect(before).toBeGreaterThanOrEqual(60)
    expect(looseObjects(repo.dir)).toBeLessThan(before)
    expect(log.info).toEqual(["omo-senpi memory repo packed"])
    expect(log.warn).toEqual([])
    expect((await repo.log()).length).toBe(21)
  }, 60_000)

  test("#given maintenance is running #when another session commits at the same time #then that commit succeeds and survives the pack", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const maintenance = createMemoryMaintenance({ delayMs: 0, minLooseObjects: 10 })

    // when
    maintenance.schedule(context)
    await writeFile(join(repo.dir, "concurrent.md"), "written during maintenance\n")
    const concurrent = repo.commitWrite(["concurrent.md"], "concurrent note", { agentId: context.identity, authorName: context.identity })
    await Promise.all([concurrent, maintenance.settled()])

    // then
    const subjects = (await repo.log()).map((commit) => commit.subject)
    expect(subjects).toContain("concurrent note")
    expect(execFileSync("git", ["fsck", "--connectivity-only"], { cwd: repo.dir, encoding: "utf8" })).not.toContain("missing")
  }, 60_000)

  test("#given a pass ran recently for this identity #when a second process schedules one #then it does not run again within the interval", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const first = createMemoryMaintenance({ delayMs: 0, minLooseObjects: 10 })
    first.schedule(context)
    await first.settled()
    for (let index = 20; index < 40; index += 1) {
      await writeFile(join(repo.dir, `note-${index}.md`), `note ${index}\n`)
      await repo.commitWrite([`note-${index}.md`], `note ${index}`, { agentId: context.identity, authorName: context.identity })
    }
    const looseAfterNewCommits = looseObjects(repo.dir)
    const log = recorder()
    const second = createMemoryMaintenance({ logger: log.logger, delayMs: 0, minLooseObjects: 10 })

    // when
    second.schedule(context)
    await second.settled()

    // then
    expect(looseObjects(repo.dir)).toBe(looseAfterNewCommits)
    expect(log.info).toEqual([])
  }, 60_000)

  test("#given an identity whose repo does not exist yet #when maintenance is scheduled #then it does nothing and logs no failure", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-maintenance-")))
    roots.push(root)
    const identityPaths = buildIdentityPaths(root, "transient-agent")
    const context = createMemoryIdentityContext({
      identity: "transient-agent",
      identityPaths,
      binding: createMemoryBinding({ identity: "transient-agent", repoPath: identityPaths.repo, boundAt: 1 }),
    })
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, minLooseObjects: 1 })

    // when
    maintenance.schedule(context)
    await maintenance.settled()

    // then
    expect(log.warn).toEqual([])
    expect(log.info).toEqual([])
  }, 30_000)

  test("#given ten sessions bind to the same identity at once #when their passes come due #then exactly one pack runs", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const log = recorder()
    const runners = Array.from({ length: 10 }, () => createMemoryMaintenance({ logger: log.logger, delayMs: 0, minLooseObjects: 10 }))

    // when
    for (const runner of runners) runner.schedule(context)
    await Promise.all(runners.map((runner) => runner.settled()))

    // then
    expect(log.info).toEqual(["omo-senpi memory repo packed"])
    expect(log.warn).toEqual([])
    expect(looseObjects(repo.dir)).toBe(0)
  }, 60_000)

  test("#given another process holds the maintenance lock #when this session's pass comes due #then it skips without packing or warning", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const before = looseObjects(repo.dir)
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, minLooseObjects: 10 })
    const holder = await createLockRecord("memory-maintenance", { runId: "other-process" })

    // when
    await withLock(memoryMaintenanceLockPath(context.identityPaths.locks), holder, async () => {
      maintenance.schedule(context)
      await maintenance.settled()
    })

    // then
    expect(looseObjects(repo.dir)).toBe(before)
    expect(log.info).toEqual([])
    expect(log.warn).toEqual([])
  }, 60_000)

  test("#given a pass is scheduled #when the session exits first #then nothing runs and nothing is logged", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const before = looseObjects(repo.dir)
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 60_000, minLooseObjects: 10 })
    maintenance.schedule(context)

    // when
    maintenance.dispose()
    await maintenance.settled()

    // then
    expect(looseObjects(repo.dir)).toBe(before)
    expect(log.info).toEqual([])
    expect(log.warn).toEqual([])
  }, 60_000)

  test("#given a loose object no commit references yet (a writer mid-commit) #when a pass packs the repo #then that object is kept", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const pending = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.dir, input: "staged by a writer\n", encoding: "utf8" }).trim()
    const maintenance = createMemoryMaintenance({ delayMs: 0, minLooseObjects: 10 })

    // when
    maintenance.schedule(context)
    await maintenance.settled()

    // then
    expect(execFileSync("git", ["cat-file", "-p", pending], { cwd: repo.dir, encoding: "utf8" })).toBe("staged by a writer\n")
  }, 60_000)

  test("#given a shared host where one session exits before its pass #when another session binds later #then that session's pass runs", async () => {
    // given
    const { context, repo } = await identityWithHistory(20)
    const log = recorder()
    const host = createMemoryMaintenance({ logger: log.logger, delayMs: 0, minLooseObjects: 10 })
    host.schedule(context)
    host.dispose()
    await host.settled()
    expect(log.info).toEqual([])

    // when
    host.schedule(context)
    await host.settled()

    // then
    expect(log.info).toEqual(["omo-senpi memory repo packed"])
    expect(looseObjects(repo.dir)).toBe(0)
  }, 60_000)

  test("#given empty transcript journals left by older builds #when maintenance runs #then the idle ones are removed and counted, a live session's is kept (#9737)", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-maintenance-")))
    roots.push(root)
    const identityPaths = buildIdentityPaths(root, "transient-agent")
    const context = createMemoryIdentityContext({
      identity: "transient-agent",
      identityPaths,
      binding: createMemoryBinding({ identity: "transient-agent", repoPath: identityPaths.repo, boundAt: 1 }),
    })
    const old = new Date(Date.now() - 60 * 60 * 1000)
    for (const sessionId of ["stale-control", "live-control"]) {
      const dir = join(identityPaths.transcripts, sessionId)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "transcript.jsonl"), "")
      await writeFile(join(dir, "state.json"), JSON.stringify({ schema_version: "v3_assistant_steps", total_completed_steps: 0 }))
      for (const file of ["transcript.jsonl", "state.json"]) await utimes(join(dir, file), old, old)
      await utimes(dir, old, old)
    }
    const log = recorder()
    const maintenance = createMemoryMaintenance({
      logger: log.logger,
      delayMs: 0,
      isLiveSession: (sessionId) => sessionId === "live-control",
    })

    // when
    maintenance.schedule(context)
    await maintenance.settled()

    // then
    expect(existsSync(join(identityPaths.transcripts, "stale-control"))).toBe(false)
    expect(existsSync(join(identityPaths.transcripts, "live-control"))).toBe(true)
    expect(log.info).toEqual(["omo-senpi memory removed empty transcript journals"])
    expect(log.warn).toEqual([])
  }, 30_000)

  test("#given a control session that exits right after it binds #when maintenance is disposed before the repack delay #then the empty journal sweep still runs (#9737)", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-maintenance-")))
    roots.push(root)
    const identityPaths = buildIdentityPaths(root, "transient-agent")
    const context = createMemoryIdentityContext({
      identity: "transient-agent",
      identityPaths,
      binding: createMemoryBinding({ identity: "transient-agent", repoPath: identityPaths.repo, boundAt: 1 }),
    })
    const old = new Date(Date.now() - 60 * 60 * 1000)
    const dir = join(identityPaths.transcripts, "health-check")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "transcript.jsonl"), "")
    await utimes(join(dir, "transcript.jsonl"), old, old)
    await utimes(dir, old, old)
    const maintenance = createMemoryMaintenance({ delayMs: 60_000 })

    // when
    maintenance.schedule(context)
    maintenance.dispose()
    await maintenance.settled()

    // then
    expect(existsSync(dir)).toBe(false)
  }, 30_000)

  test("#given the sweep ran for an identity #when a later session in the same process schedules maintenance #then it does not sweep again (#9737)", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-maintenance-")))
    roots.push(root)
    const identityPaths = buildIdentityPaths(root, "transient-agent")
    const context = createMemoryIdentityContext({
      identity: "transient-agent",
      identityPaths,
      binding: createMemoryBinding({ identity: "transient-agent", repoPath: identityPaths.repo, boundAt: 1 }),
    })
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 60_000 })
    maintenance.schedule(context)
    maintenance.dispose()
    await maintenance.settled()
    const old = new Date(Date.now() - 60 * 60 * 1000)
    const dir = join(identityPaths.transcripts, "later-empty")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "transcript.jsonl"), "")
    await utimes(join(dir, "transcript.jsonl"), old, old)
    await utimes(dir, old, old)

    // when
    maintenance.schedule(context)
    maintenance.dispose()
    await maintenance.settled()

    // then
    expect(existsSync(dir)).toBe(true)
  }, 30_000)
})

describe("runtime retention inside the maintenance pass (A23)", () => {
  const NOW = Date.parse("2026-11-05T00:00:00.000Z")
  const DAY = 24 * 60 * 60 * 1000

  async function identityWithOldRun() {
    const { context, repo } = await identityWithHistory(0)
    const runDir = join(context.identityPaths.reflection, "runs", "reflection-run-1")
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, "final.json"), JSON.stringify({ runId: "reflection-run-1", outcome: "merged", finishedAt: new Date(NOW - 8 * DAY).toISOString() }))
    await utimes(join(runDir, "final.json"), new Date(NOW - 8 * DAY), new Date(NOW - 8 * DAY))
    await utimes(runDir, new Date(NOW - 8 * DAY), new Date(NOW - 8 * DAY))
    const newest = join(context.identityPaths.reflection, "runs", "reflection-run-2")
    await mkdir(newest, { recursive: true })
    await writeFile(join(newest, "final.json"), JSON.stringify({ runId: "reflection-run-2", outcome: "merged", finishedAt: new Date(NOW - DAY).toISOString() }))
    return { context, repo, runDir }
  }

  test("#given a fresh retention stamp #when a pass is scheduled #then retention does not run", async () => {
    const { context, repo, runDir } = await identityWithOldRun()
    await repo.configSet("omo.retentionAt", String(NOW - 60_000))
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, now: () => NOW })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(existsSync(runDir)).toBe(true)
    expect(log.info.filter((message) => message === "omo-senpi memory runtime retention")).toEqual([])
  })

  test("#given a stale stamp and two sessions scheduling at once #when their passes come due #then retention runs exactly once", async () => {
    const { context, runDir } = await identityWithOldRun()
    const first = recorder()
    const second = recorder()
    const a = createMemoryMaintenance({ logger: first.logger, delayMs: 0, now: () => NOW })
    const b = createMemoryMaintenance({ logger: second.logger, delayMs: 0, now: () => NOW })

    a.schedule(context)
    b.schedule(context)
    await Promise.all([a.settled(), b.settled()])

    expect(existsSync(runDir)).toBe(false)
    const runs = [...first.info, ...second.info].filter((message) => message === "omo-senpi memory runtime retention")
    expect(runs).toEqual(["omo-senpi memory runtime retention"])
    expect([...first.warn, ...second.warn]).toEqual([])
  }, 60_000)
})

describe("retention stamp and resume (A33 maintenance half)", () => {
  const NOW = Date.parse("2026-11-05T00:00:00.000Z")
  const DAY = 24 * 60 * 60 * 1000

  test("#given a cursor file and a fresh omo.maintenanceAt #when maintenance is scheduled #then retention still runs, finishes, stamps omo.retentionAt and deletes the cursor; a later pass within 12 h writes nothing", async () => {
    const { context, repo } = await identityWithHistory(0)
    const runs = join(context.identityPaths.reflection, "runs")
    for (const runId of ["reflection-run-1", "reflection-run-2"]) {
      await mkdir(join(runs, runId), { recursive: true })
      await writeFile(join(runs, runId, "final.json"), JSON.stringify({ runId, outcome: "merged", finishedAt: new Date(NOW - 8 * DAY).toISOString() }))
      await utimes(join(runs, runId, "final.json"), new Date(NOW - 8 * DAY), new Date(NOW - 8 * DAY))
      await utimes(join(runs, runId), new Date(NOW - 8 * DAY), new Date(NOW - 8 * DAY))
    }
    await mkdir(join(runs, "reflection-run-3"), { recursive: true })
    await writeFile(join(runs, "reflection-run-3", "final.json"), JSON.stringify({ runId: "reflection-run-3", outcome: "merged", finishedAt: new Date(NOW - DAY).toISOString() }))
    await repo.configSet("omo.maintenanceAt", String(NOW - 60_000))
    await writeFile(join(context.identityPaths.runtime, "retention.json"), JSON.stringify({ version: 1, cursor: { store: "runs", lastName: "reflection-run-1" } }))

    const first = createMemoryMaintenance({ delayMs: 0, now: () => NOW })
    first.schedule(context)
    await first.settled()

    expect(existsSync(join(runs, "reflection-run-1"))).toBe(true)
    expect(existsSync(join(runs, "reflection-run-2"))).toBe(false)
    expect(existsSync(join(context.identityPaths.runtime, "retention.json"))).toBe(false)
    expect(await repo.configGet("omo.retentionAt")).toBe(String(NOW))
    expect(await repo.configGet("omo.maintenanceAt")).toBe(String(NOW - 60_000))

    const runtimeMtime = (await stat(context.identityPaths.runtime)).mtimeMs
    const reflectionMtime = (await stat(context.identityPaths.reflection)).mtimeMs
    const later = createMemoryMaintenance({ delayMs: 0, now: () => NOW + 60 * 60 * 1000 })
    later.schedule(context)
    await later.settled()
    expect(existsSync(join(runs, "reflection-run-1"))).toBe(true)
    expect((await stat(context.identityPaths.runtime)).mtimeMs).toBe(runtimeMtime)
    expect((await stat(context.identityPaths.reflection)).mtimeMs).toBe(reflectionMtime)
  }, 60_000)
})

describe("a cap that cannot measure inside the budget is throttled to the interval (#12538 review r5 L1)", () => {
  const NOW = Date.parse("2026-11-05T00:00:00.000Z")
  const HOUR = 60 * 60 * 1000
  const resume = { store: "cap", tier: "folded-run", clock: 0, lastName: "reflection-run-0" }
  // A pass budget of 0 ms: the stores are empty, so the store walk finishes, and the cap's size walk
  // always overruns what is left, so the cap can never measure runtime/.
  const zeroBudget = { resolveRetention: () => ({ ...DEFAULT_RUNTIME_RETENTION, passBudgetMs: 0 }), resolveMaxBytes: () => 1 }

  test("#given a stored cap resume point and a size walk that always overruns #when the pass runs #then it stamps omo.retentionAt and the next bind inside the interval does not run retention", async () => {
    const { context, repo } = await identityWithHistory(0)
    const cursorFile = join(context.identityPaths.runtime, "retention.json")
    await mkdir(context.identityPaths.runtime, { recursive: true })
    await writeFile(cursorFile, JSON.stringify({ version: 1, cap: resume }))

    const first = recorder()
    const stalled = createMemoryMaintenance({ logger: first.logger, delayMs: 0, now: () => NOW, ...zeroBudget })
    stalled.schedule(context)
    await stalled.settled()

    expect(first.info).toContain("omo-senpi memory runtime retention")
    expect(await repo.configGet("omo.retentionAt")).toBe(String(NOW))
    const kept = await readFile(cursorFile, "utf8")
    expect((JSON.parse(kept) as { cap?: unknown }).cap).toEqual(resume)

    const second = recorder()
    const later = createMemoryMaintenance({ logger: second.logger, delayMs: 0, now: () => NOW + HOUR, ...zeroBudget })
    later.schedule(context)
    await later.settled()

    expect(second.info.filter((message) => message === "omo-senpi memory runtime retention")).toEqual([])
    expect(await repo.configGet("omo.retentionAt")).toBe(String(NOW))
    expect(await readFile(cursorFile, "utf8")).toBe(kept)
  }, 60_000)

  test("#given a fresh omo.retentionAt and a cap resume point left by a pass that made progress #when the next bind runs #then retention resumes the cap and completes", async () => {
    const { context, repo } = await identityWithHistory(0)
    const cursorFile = join(context.identityPaths.runtime, "retention.json")
    await mkdir(context.identityPaths.runtime, { recursive: true })
    await writeFile(cursorFile, JSON.stringify({ version: 1, cap: resume }))
    await repo.configSet("omo.retentionAt", String(NOW - HOUR))

    const maintenance = createMemoryMaintenance({ delayMs: 0, now: () => NOW, resolveMaxBytes: () => 1 })
    maintenance.schedule(context)
    await maintenance.settled()

    expect(existsSync(cursorFile)).toBe(false)
    expect(await repo.configGet("omo.retentionAt")).toBe(String(NOW))
  }, 60_000)
})

describe("host sweep driver 2 (6b, A34 in-session half)", () => {
  const NOW = Date.parse("2026-11-05T00:00:00.000Z")
  const DAY = 24 * 60 * 60 * 1000

  async function foreignWithOldRun(memoryRoot: string): Promise<string> {
    const runs = join(memoryRoot, "agents", "foreign-agent", "runtime", "reflection", "runs")
    for (const [runId, age] of [["reflection-run-1", 8], ["reflection-run-9", 1]] as const) {
      await mkdir(join(runs, runId), { recursive: true })
      await writeFile(join(runs, runId, "final.json"), JSON.stringify({ runId, outcome: "merged", finishedAt: new Date(NOW - age * DAY).toISOString() }))
      await utimes(join(runs, runId, "final.json"), new Date(NOW - age * DAY), new Date(NOW - age * DAY))
      await utimes(join(runs, runId), new Date(NOW - age * DAY), new Date(NOW - age * DAY))
    }
    return join(runs, "reflection-run-1")
  }

  test("#given a foreign repo-less identity with a folded run past retention #when a bound session's pass runs with driver 2 on #then the foreign run is pruned and the host round completes", async () => {
    const { context } = await identityWithHistory(0)
    const memoryRoot = join(context.identityPaths.root, "..", "..")
    const foreignRun = await foreignWithOldRun(memoryRoot)
    const maintenance = createMemoryMaintenance({ delayMs: 0, now: () => NOW, hostSweep: () => ({}) })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(existsSync(foreignRun)).toBe(false)
    expect(existsSync(join(memoryRoot, "runtime-sweep.json"))).toBe(true)
  }, 60_000)

  test("#given a bound identity whose live session has a fully reflected journal past retention #when the pass runs with driver 2 on #then the host sweep does not revisit the bound identity and the journal stays (REVIEW-5 M2)", async () => {
    const { context } = await identityWithHistory(0)
    const journalDir = join(context.identityPaths.transcripts, "live-session")
    const journal = new TranscriptJournal({ journalDir, now: () => new Date(NOW - 20 * DAY) })
    await journal.reconcile([
      { kind: "user", messageId: "u1", text: "first" },
      { kind: "assistant", messageId: "a1", textBlocks: ["first answer"] },
    ])
    const snapshot = await journal.captureReflectionSnapshot()
    if (snapshot === null) throw new Error("expected a snapshot")
    await journal.finalizeReflection(snapshot, true)
    for (const name of ["state.json", "transcript.jsonl"]) await utimes(join(journalDir, name), new Date(NOW - 20 * DAY), new Date(NOW - 20 * DAY))
    await utimes(journalDir, new Date(NOW - 20 * DAY), new Date(NOW - 20 * DAY))
    const maintenance = createMemoryMaintenance({ delayMs: 0, now: () => NOW, isLiveSession: (id) => id === "live-session", hostSweep: () => ({}) })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(existsSync(join(journalDir, "transcript.jsonl"))).toBe(true)
  }, 60_000)

  test("#given driver 2 disabled (CI, task child) #when the pass runs #then foreign identities are untouched", async () => {
    const { context } = await identityWithHistory(0)
    const memoryRoot = join(context.identityPaths.root, "..", "..")
    const foreignRun = await foreignWithOldRun(memoryRoot)
    const maintenance = createMemoryMaintenance({ delayMs: 0, now: () => NOW })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(existsSync(foreignRun)).toBe(true)
    expect(existsSync(join(memoryRoot, "runtime-sweep.json"))).toBe(false)
  }, 60_000)
})

describe("runtime size cap inside the maintenance pass (B08)", () => {
  const NOW = Date.parse("2026-11-05T00:00:00.000Z")
  const DAY = 24 * 60 * 60 * 1000

  async function identityWithYoungRuns() {
    const { context } = await identityWithHistory(0)
    const runDirs: string[] = []
    for (const [index, days] of [[3, 3], [4, 2], [5, 1]] as const) {
      const runDir = join(context.identityPaths.reflection, "runs", `reflection-run-${index}`)
      await mkdir(runDir, { recursive: true })
      await writeFile(join(runDir, "final.json"), JSON.stringify({ runId: `reflection-run-${index}`, outcome: "merged", finishedAt: new Date(NOW - days * DAY).toISOString() }))
      await writeFile(join(runDir, "child-1.log"), Buffer.alloc(64 * 1024, 1))
      runDirs.push(runDir)
    }
    return { context, runDirs }
  }

  test("#given an identity over its cap #when the pass runs #then the cap evicts the oldest folded runs and logs the figures", async () => {
    const { context, runDirs } = await identityWithYoungRuns()
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, now: () => NOW, resolveMaxBytes: () => 1 })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(runDirs.map((dir) => existsSync(dir))).toEqual([false, false, true])
    const line = log.infoData.find((entry) => entry.message === "omo-senpi memory runtime retention")
    expect(line?.data?.evicted).toBe(2)
    expect(line?.data?.capBytes).toBe(1)
    expect(log.warn).toEqual(["omo-senpi memory runtime cap exceeded, nothing evictable"])
  }, 60_000)

  test("#given memory settings whose agents.<id>.runtime.max_bytes caps this identity #when the pass runs #then the sidecar resolves that cap and evicts", async () => {
    const { context, runDirs } = await identityWithYoungRuns()
    const log = recorder()
    const settings = OmoMemorySettingsSchema.parse({ agents: { [context.identity]: { runtime: { max_bytes: 1 } } } })
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, now: () => NOW, memorySettings: () => settings })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(runDirs.map((dir) => existsSync(dir))).toEqual([false, false, true])
    expect(log.infoData.find((entry) => entry.message === "omo-senpi memory runtime retention")?.data?.capBytes).toBe(1)
    expect(log.warn).toEqual(["omo-senpi memory runtime cap exceeded, nothing evictable"])
  }, 60_000)

  test("#given memory settings that cap only another identity #when the pass runs #then this identity keeps the global cap and nothing is evicted", async () => {
    const { context, runDirs } = await identityWithYoungRuns()
    const log = recorder()
    const settings = OmoMemorySettingsSchema.parse({ agents: { "other-agent": { runtime: { max_bytes: 1 } } } })
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, now: () => NOW, memorySettings: () => settings })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(runDirs.map((dir) => existsSync(dir))).toEqual([true, true, true])
    expect(log.warn).toEqual([])
  }, 60_000)

  test("#given the reflection-scheduler lock is busy so the journal tiers are skipped #when the over-cap pass runs #then it does not log nothing-evictable (#12538 review L4)", async () => {
    const { context, runDirs } = await identityWithYoungRuns()
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, now: () => NOW, resolveMaxBytes: () => 1 })
    const holder = await createLockRecord("reflection-scheduler", { runId: "other-process" })
    await mkdir(context.identityPaths.locks, { recursive: true })

    await withLock(reflectionSchedulerLockPath(context.identityPaths.locks), holder, async () => {
      maintenance.schedule(context)
      await maintenance.settled()
    }, { waitTimeoutMs: 0 })

    expect(runDirs.map((dir) => existsSync(dir))).toEqual([false, false, true])
    expect(log.warn).not.toContain("omo-senpi memory runtime cap exceeded, nothing evictable")
    expect(log.warn).toEqual(["omo-senpi memory runtime cap exceeded, eviction continues next pass"])
  }, 60_000)

  test("#given another process holds the maintenance lock #when the pass comes due #then the cap skips without waiting or evicting", async () => {
    const { context, runDirs } = await identityWithYoungRuns()
    const log = recorder()
    const maintenance = createMemoryMaintenance({ logger: log.logger, delayMs: 0, now: () => NOW, resolveMaxBytes: () => 1 })
    const holder = await createLockRecord("memory-maintenance", { runId: "other-process" })

    await withLock(memoryMaintenanceLockPath(context.identityPaths.locks), holder, async () => {
      maintenance.schedule(context)
      await maintenance.settled()
    }, { waitTimeoutMs: 0 })

    expect(runDirs.every((dir) => existsSync(dir))).toBe(true)
    expect(log.info).toEqual([])
    expect(log.warn).toEqual([])
  }, 60_000)
})
