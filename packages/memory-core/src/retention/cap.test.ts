import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { acquireLock, createLockRecord, reflectionSchedulerLockPath, releaseLock } from "../locks"
import { scanReflectionRunHighWater } from "../reflection/run-id-high-water"
import { measureRuntimeCapEvictableBytes, runRuntimeSizeCap, type RuntimeSizeCapOptions } from "./cap"
import { readReflectionRetentionGuard } from "./guard"
import { DEFAULT_RUNTIME_RETENTION, runRuntimeRetention } from "./index"
import {
  DAY_MS,
  NOW,
  ageTree,
  cleanupRoots,
  daysAgo,
  identity,
  journal,
  now,
  reflectionRun,
  runIdMark,
  runsDir,
  sidecar,
  writeJson,
} from "./retention.test-support"
import { measureRuntimeSize, measureTreeBytes } from "./size"
import type { MemoryIdentityPaths } from "../identity/layout"

afterEach(cleanupRoots)
// Fixtures build dozens of real run dirs and journals; on a loaded shared host that alone can pass the
// 5 s default, and a timed-out body keeps running into the next test. The bound is a breaker, not a wait.
setDefaultTimeout(30_000)

const HOUR_MS = 60 * 60 * 1000
const hoursAgo = (hours: number): number => NOW - hours * HOUR_MS

// `discard_unreflected_journals` defaults OFF (the LEAD's D1 call); B02, B12 and B18 run the default and
// an explicit switch-on row (health-gated, the r4 behaviour).
const UNREFLECTED_ON = { ...DEFAULT_RUNTIME_RETENTION, abandonedJournalDays: 14, discardUnreflectedJournals: true }
const UNREFLECTED_DEFAULT = { ...DEFAULT_RUNTIME_RETENTION, abandonedJournalDays: 14 }
const UNREFLECTED_OFF = { ...DEFAULT_RUNTIME_RETENTION, abandonedJournalDays: 14, discardUnreflectedJournals: false }

function cap(paths: MemoryIdentityPaths, maxBytes: number, extra: Partial<RuntimeSizeCapOptions> = {}) {
  return runRuntimeSizeCap({ paths, policy: UNREFLECTED_ON, maxBytes, now, ...extra })
}

async function padded(dir: string, bytes: number, at: number): Promise<string> {
  await writeFile(join(dir, "padding.bin"), Buffer.alloc(bytes, 1))
  await ageTree(dir, at)
  return dir
}

// The cap's guard creates locks/ and raises run-id.json before it measures; settle both first so a
// test's own measure is the one the cap sees.
async function settleGuard(paths: MemoryIdentityPaths): Promise<void> {
  await readReflectionRetentionGuard({ paths, policy: UNREFLECTED_ON, now })
}

async function foldedRuns(paths: MemoryIdentityPaths, count: number, bytes = 64 * 1024): Promise<string[]> {
  const ids: string[] = []
  for (let index = 1; index <= count; index += 1) {
    const runId = `reflection-run-${index}`
    const finishedAt = daysAgo(count - index + 1) + index
    await padded(await reflectionRun(paths, runId, { outcome: index % 2 === 0 ? "no_changes" : "merged", finishedAt }), bytes, finishedAt)
    ids.push(runId)
  }
  return ids
}

async function bytesOf(paths: MemoryIdentityPaths, runIds: readonly string[]): Promise<number> {
  let total = 0
  for (const runId of runIds) total += await measureTreeBytes(join(runsDir(paths), runId))
  return total
}

async function liveNames(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [] as string[])).filter((name) => !name.startsWith(".prune-")).sort()
}

describe("runtime size cap: eviction order", () => {
  test("#given folded runs, sidecars and journals over the cap #when the cap runs #then folded runs go oldest-first until it fits and nothing else is touched (B01)", async () => {
    const paths = await identity()
    const runs = await foldedRuns(paths, 10)
    const sidecars = await Promise.all([1, 2, 3, 4, 5].map(async (n) => padded(await sidecar(paths, `s-${n}`, daysAgo(1)), 32 * 1024, daysAgo(1))))
    const journals = await Promise.all([1, 2, 3, 4, 5].map((n) => journal(paths, `j-${n}`, "never", daysAgo(3))))
    await settleGuard(paths)
    const before = (await measureRuntimeSize(paths.runtime)).bytes
    const maxBytes = before - (await bytesOf(paths, runs.slice(0, 3)))

    const report = await cap(paths, maxBytes)

    expect(report.evicted.map((entry) => [entry.tier, entry.name])).toEqual(runs.slice(0, 3).map((runId) => ["folded-run", runId]))
    expect(await liveNames(runsDir(paths))).toEqual(runs.slice(3).sort())
    for (const dir of [...sidecars, ...journals]) expect(existsSync(dir)).toBe(true)
    expect(report.afterBytes).toBeLessThanOrEqual(maxBytes)
    expect(report.exceededBytes).toBe(0)
  })

  test("#given too few folded bytes #when the cap runs #then sidecars idle past 1 h and journals idle past 24 h follow, and the hot ones survive (B02 on)", async () => {
    const paths = await identity()
    await foldedRuns(paths, 3, 1024)
    const oldSidecars = [5, 4, 3, 2].map((hours) => `side-${hours}h`)
    for (const [index, name] of oldSidecars.entries()) await padded(await sidecar(paths, name, hoursAgo(5 - index)), 8 * 1024, hoursAgo(5 - index))
    const hotSidecar = await sidecar(paths, "side-hot", NOW - 30 * 60 * 1000)
    const oldJournal = await journal(paths, "j-old", "never", daysAgo(3))
    const hotJournal = await journal(paths, "j-hot", "never", hoursAgo(1))

    const report = await cap(paths, 1)

    const tiers = report.evicted.map((entry) => entry.tier)
    expect(tiers).toEqual([...tiers].sort((left, right) => TIER_ORDER.indexOf(left) - TIER_ORDER.indexOf(right)))
    expect(report.evicted.filter((entry) => entry.tier === "sidecar").map((entry) => entry.name)).toEqual(
      oldSidecars.map((name) => Buffer.from(name, "utf8").toString("base64url")),
    )
    expect(report.evicted.filter((entry) => entry.tier === "never-reflected-journal").map((entry) => entry.name)).toEqual(["j-old"])
    expect(existsSync(oldJournal)).toBe(false)
    expect(existsSync(hotJournal)).toBe(true)
    expect(existsSync(hotSidecar)).toBe(true)
    expect(report.exceededBytes).toBeGreaterThan(0)
  })

  test("#given the switch on #when the cap reaches the journal tiers #then never- and partly-reflected journals are evicted too (B02 on)", async () => {
    const paths = await identity()
    await foldedRuns(paths, 3, 1024)
    const oldJournal = await journal(paths, "j-old", "never", daysAgo(3))
    const partly = await journal(paths, "j-partly", "partly", daysAgo(3))

    const report = await cap(paths, 1, { policy: UNREFLECTED_ON })

    expect(report.evicted.map((entry) => entry.tier)).toEqual(["folded-run", "folded-run", "never-reflected-journal", "partly-reflected-transcript"])
    expect(existsSync(oldJournal)).toBe(false)
    expect(existsSync(join(partly, "transcript.jsonl"))).toBe(false)
  })

  test("#given the default switch (off) #when the cap reaches the journal tiers #then never- and partly-reflected journals stay (B02 default, off)", async () => {
    const paths = await identity()
    await foldedRuns(paths, 3, 1024)
    const oldJournal = await journal(paths, "j-old", "never", daysAgo(3))
    const partly = await journal(paths, "j-partly", "partly", daysAgo(3))
    const oldSidecar = await padded(await sidecar(paths, "side-5h", hoursAgo(5)), 8 * 1024, hoursAgo(5))

    const report = await cap(paths, 1, { policy: UNREFLECTED_DEFAULT })

    expect(report.evicted.map((entry) => entry.tier)).toEqual(["folded-run", "folded-run", "sidecar"])
    expect(existsSync(oldSidecar)).toBe(false)
    expect(existsSync(oldJournal)).toBe(true)
    expect(existsSync(join(partly, "transcript.jsonl"))).toBe(true)
    expect(report.kept["j-old"]).toBe("unreflected-retention-off")
  })

  test("#given only in-flight runs, a live journal and an owned sidecar over the cap #when the cap runs #then only the idle sibling is evicted and the excess is reported (B03)", async () => {
    const paths = await identity()
    const inFlight = await padded(await reflectionRun(paths, "reflection-run-4", { sentinel: "none", finishedAt: daysAgo(20) }), 64 * 1024, daysAgo(20))
    const live = await journal(paths, "j-live", "never", daysAgo(5))
    const owned = await sidecar(paths, "owned", daysAgo(5))
    const ownedName = Buffer.from("owned", "utf8").toString("base64url")
    const control = await journal(paths, "j-idle", "never", daysAgo(5))

    const report = await cap(paths, 1, { isLiveSession: (sessionId) => sessionId === "j-live", ownedSidecars: new Set([ownedName]) })

    expect(report.evicted.map((entry) => entry.name)).toEqual(["j-idle"])
    expect(existsSync(control)).toBe(false)
    expect(report.exceededBytes).toBe(report.afterBytes - 1)
    for (const dir of [inFlight, live, owned]) expect(existsSync(dir)).toBe(true)
  })

  test("#given 15 unfolded terminal runs past retention #when the cap reaches tier 6 #then the 5 oldest go and the newest 10 keep their child logs (B04)", async () => {
    const paths = await identity()
    const ids: string[] = []
    for (let index = 1; index <= 15; index += 1) {
      const runId = `reflection-run-${index}`
      const finishedAt = daysAgo(30 - index)
      const sentinel = index % 3 === 0 ? "abandoned" : "final"
      await padded(await reflectionRun(paths, runId, { outcome: "failed", sentinel, finishedAt }), 4 * 1024, finishedAt)
      ids.push(runId)
    }

    const report = await cap(paths, 1)

    expect(report.evicted.filter((entry) => entry.tier === "unfolded-run").map((entry) => entry.name)).toEqual(ids.slice(0, 5))
    expect(await liveNames(runsDir(paths))).toEqual(ids.slice(5).sort())
    for (const runId of ids.slice(5)) expect(existsSync(join(runsDir(paths), runId, "child-1.log"))).toBe(true)
  })

  test("#given unfolded runs beyond the newest 10 that are younger than retention #when the cap reaches tier 6 #then they are kept as recent (B04)", async () => {
    const paths = await identity()
    for (let index = 1; index <= 12; index += 1) {
      await reflectionRun(paths, `reflection-run-${index}`, { outcome: "failed", finishedAt: daysAgo(6) + index * HOUR_MS })
    }

    const report = await cap(paths, 1)

    expect(report.evicted).toEqual([])
    expect(report.kept["reflection-run-1"]).toBe("recent")
    expect(report.kept["reflection-run-2"]).toBe("recent")
  })

  test("#given the two run anchors inside tier 1 #when the cap wants every folded run gone #then both anchors survive (B05)", async () => {
    const paths = await identity()
    await padded(await reflectionRun(paths, "reflection-run-50", { finishedAt: daysAgo(6) }), 16 * 1024, daysAgo(6))
    await foldedRuns(paths, 4)

    const report = await cap(paths, 1)

    expect(report.evicted.map((entry) => entry.name)).toEqual(["reflection-run-1", "reflection-run-2", "reflection-run-3"])
    expect(report.kept["reflection-run-50"]).toBe("high-water")
    expect(report.kept["reflection-run-4"]).toBe("newest")
    expect(await liveNames(runsDir(paths))).toEqual(["reflection-run-4", "reflection-run-50"])
  })

  test("#given max_bytes 0 #when the cap runs #then it measures and evicts nothing (B06)", async () => {
    const paths = await identity()
    await foldedRuns(paths, 3)

    const report = await cap(paths, 0)

    expect(report.evicted).toEqual([])
    expect(report.beforeBytes).toBeGreaterThan(0)
    expect(await liveNames(runsDir(paths))).toHaveLength(3)
    expect((await cap(paths, 1)).evicted.map((entry) => entry.name)).toEqual(["reflection-run-1", "reflection-run-2"])
  })
})

describe("runtime size cap: crash windows and claims", () => {
  test("#given an eviction interrupted after its tombstone rename #when the next cap runs #then the tombstone goes and eviction continues (B07)", async () => {
    const paths = await identity()
    const runs = await foldedRuns(paths, 4)
    await settleGuard(paths)
    const tombstone = join(runsDir(paths), ".prune-reflection-run-0-4b0f")
    await mkdir(tombstone, { recursive: true })
    await writeFile(join(tombstone, "child-1.log"), "left by an interrupted pass\n")
    const maxBytes = (await measureRuntimeSize(paths.runtime)).bytes - (await measureTreeBytes(tombstone)) - (await bytesOf(paths, runs.slice(0, 1)))

    const report = await cap(paths, maxBytes)

    expect(existsSync(tombstone)).toBe(false)
    expect(report.evicted.map((entry) => entry.name)).toEqual(runs.slice(0, 1))
  })

  test("#given an aborted signal #when the cap runs #then it evicts nothing and rejects with the abort", async () => {
    const paths = await identity()
    await foldedRuns(paths, 3)
    const controller = new AbortController()
    controller.abort()

    await expect(cap(paths, 1, { signal: controller.signal })).rejects.toThrow()
    expect(await liveNames(runsDir(paths))).toHaveLength(3)
  })

  test("#given run dirs holding read-only payload files in tiers 1 and 6 #when the cap evicts them #then every selected dir is removed completely (B13)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-1", { outcome: "merged", finishedAt: daysAgo(3), readOnlyPayload: true })
    await reflectionRun(paths, "reflection-run-2", { outcome: "merged", finishedAt: daysAgo(2), readOnlyPayload: true })
    await reflectionRun(paths, "reflection-run-3", { outcome: "failed", finishedAt: daysAgo(40), readOnlyPayload: true })
    for (let index = 4; index <= 13; index += 1) {
      await reflectionRun(paths, `reflection-run-${index}`, { outcome: "failed", finishedAt: daysAgo(30) + index })
    }
    await reflectionRun(paths, "reflection-run-20", { outcome: "merged", finishedAt: daysAgo(1) })

    const report = await cap(paths, 1)

    expect(report.evicted.map((entry) => entry.name)).toEqual(["reflection-run-1", "reflection-run-2", "reflection-run-3"])
    for (const runId of ["reflection-run-1", "reflection-run-2", "reflection-run-3"]) expect(existsSync(join(runsDir(paths), runId))).toBe(false)
    expect((await readdir(runsDir(paths))).filter((name) => name.startsWith(".prune-"))).toEqual([])
    expect(report.afterBytes).toBe((await measureRuntimeSize(paths.runtime)).bytes)
    expect(report.afterBytes).toBeLessThan(report.beforeBytes)
  })

  test("#given the highest-numbered trace is the oldest folded run #when the cap wants every run gone #then it survives and the next mint is unchanged (B14)", async () => {
    for (const withMark of [false, true]) {
      const paths = await identity()
      await reflectionRun(paths, "reflection-run-90", { outcome: "merged", finishedAt: daysAgo(6) })
      await foldedRuns(paths, 5)
      for (let index = 6; index <= 20; index += 1) {
        await reflectionRun(paths, `reflection-run-${index}`, { outcome: "failed", finishedAt: daysAgo(40) + index })
      }
      if (withMark) await runIdMark(paths, 90)
      const nextBefore = (await scanReflectionRunHighWater(paths)) + 1

      const report = await cap(paths, 1)

      expect(report.kept["reflection-run-90"]).toBe("high-water")
      expect(existsSync(join(runsDir(paths), "reflection-run-90"))).toBe(true)
      expect((await scanReflectionRunHighWater(paths)) + 1).toBe(nextBefore)
    }
  })
})

describe("runtime size cap: journal floor for callers without session liveness (B13 CLI variant, L5)", () => {
  test("#given the CLI's journal floor of retention_days #when the cap forces tiers 2, 4 and 5 #then only journals idle past that floor are evicted", async () => {
    const paths = await identity()
    const idleWeek = await journal(paths, "j-never-8d", "never", daysAgo(8))
    const idleDays = await journal(paths, "j-never-3d", "never", daysAgo(3))
    const fullyRecent = await journal(paths, "j-fully-3d", "fully", daysAgo(3))
    const partlyRecent = await journal(paths, "j-partly-3d", "partly", daysAgo(3))

    const report = await cap(paths, 1, { journalFloorMs: 7 * DAY_MS })

    expect(report.evicted.map((entry) => entry.name)).toEqual(["j-never-8d"])
    expect(existsSync(idleWeek)).toBe(false)
    for (const dir of [idleDays, fullyRecent, partlyRecent]) expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(fullyRecent, "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(partlyRecent, "transcript.jsonl"))).toBe(true)
  })
})

describe("runtime size cap: journals named by a reservation (B15, J0)", () => {
  async function reserve(paths: MemoryIdentityPaths, file: "active.lock" | "pending.json", runId: string, conversationIds: readonly string[]) {
    await mkdir(paths.reflection, { recursive: true })
    await writeFile(join(paths.reflection, file), JSON.stringify({ runId, reservedAt: new Date(daysAgo(1)).toISOString(), request: { trigger: "manual", conversationIds } }))
  }

  test("#given active and pending reservations naming one fully- and one never-reflected journal #when the cap forces tiers 2, 4 and 5 #then those are kept as reserved and their siblings evicted", async () => {
    const paths = await identity()
    const reservedFully = await journal(paths, "conv-x", "fully", daysAgo(3))
    const reservedNever = await journal(paths, "conv-y", "never", daysAgo(3))
    const siblingFully = await journal(paths, "conv-x2", "fully", daysAgo(3))
    const siblingNever = await journal(paths, "conv-y2", "never", daysAgo(3))
    await reserve(paths, "active.lock", "reflection-run-7", ["conv-x"])
    await reserve(paths, "pending.json", "reflection-run-8", ["conv-y"])

    const report = await cap(paths, 1)

    expect(report.kept["conv-x"]).toBe("reserved")
    expect(report.kept["conv-y"]).toBe("reserved")
    expect(existsSync(join(reservedFully, "transcript.jsonl"))).toBe(true)
    expect(existsSync(reservedNever)).toBe(true)
    expect(existsSync(join(siblingFully, "transcript.jsonl"))).toBe(false)
    expect(existsSync(siblingNever)).toBe(false)
  })

  test("#given the reflection-scheduler lock is contended #when the cap runs #then the journal tiers are skipped and tiers 1, 3 and 6 still evict", async () => {
    const paths = await identity()
    await foldedRuns(paths, 3)
    const idleSidecar = await padded(await sidecar(paths, "idle", hoursAgo(5)), 8 * 1024, hoursAgo(5))
    const neverJournal = await journal(paths, "conv-z", "never", daysAgo(3))
    await mkdir(paths.locks, { recursive: true })
    const lockPath = reflectionSchedulerLockPath(paths.locks)
    const holder = await createLockRecord("reflection-scheduler", { runId: "other-process" })
    await acquireLock(lockPath, holder)
    try {
      const report = await cap(paths, 1)

      expect(report.skipped).toContain("reflection-scheduler-busy")
      expect(report.evicted.map((entry) => entry.tier)).toEqual(["folded-run", "folded-run", "sidecar"])
      expect(existsSync(idleSidecar)).toBe(false)
      expect(existsSync(neverJournal)).toBe(true)
    } finally {
      await releaseLock(lockPath, holder)
    }
  })
})

describe("runtime size cap: health gate on unfolded journals (B17, M6)", () => {
  async function completionOf(paths: MemoryIdentityPaths, runId: string, outcome: string, finishedAt: number): Promise<void> {
    await writeJson(join(paths.reflection, "completions", `${runId}.json`), {
      schemaVersion: 1, runId, identity: "agent-test", category: "quick", conversationIds: [], trigger: "step-count", outcome,
      startedAt: new Date(finishedAt - 60_000).toISOString(), finishedAt: new Date(finishedAt).toISOString(), durationMs: 60_000,
      consecutiveFailures: outcome === "failed" ? 1 : 0, delivery: { status: "consumed" },
    })
  }

  async function shape(paths: MemoryIdentityPaths) {
    return {
      fully: await journal(paths, "j-fully", "fully", daysAgo(3)),
      never: await journal(paths, "j-never", "never", daysAgo(3)),
      partly: await journal(paths, "j-partly", "partly", daysAgo(3)),
      sidecar: await padded(await sidecar(paths, "idle", hoursAgo(5)), 8 * 1024, hoursAgo(5)),
    }
  }

  test("#given reflection failing with no fold inside abandoned_journal_days #when the cap forces tier 4 #then tiers 2 and 3 evict and tiers 4 and 5 are suspended", async () => {
    const paths = await identity()
    await completionOf(paths, "reflection-run-1", "merged", daysAgo(20))
    await completionOf(paths, "reflection-run-2", "failed", daysAgo(2))
    const dirs = await shape(paths)

    const report = await cap(paths, 1)

    expect(report.evicted.map((entry) => entry.tier)).toEqual(["fully-reflected-transcript", "sidecar"])
    expect(report.kept["j-never"]).toBe("reflection-unhealthy")
    expect(report.kept["j-partly"]).toBe("reflection-unhealthy")
    expect(report.suspendedSince).toBe(new Date(daysAgo(2)).toISOString())
    expect(existsSync(dirs.never)).toBe(true)
    expect(existsSync(join(dirs.partly, "transcript.jsonl"))).toBe(true)
    expect(existsSync(dirs.sidecar)).toBe(false)
    expect(report.exceededBytes).toBeGreaterThan(0)
  })

  test("#given a recent fold, no completions at all, or reflection disabled #when the cap forces tier 4 #then the gate is open and the journals are evicted", async () => {
    for (const variant of ["recent-fold", "no-completions", "disabled"] as const) {
      const paths = await identity()
      if (variant === "recent-fold") {
        await completionOf(paths, "reflection-run-1", "failed", daysAgo(3))
        await completionOf(paths, "reflection-run-2", "merged", daysAgo(2))
      }
      if (variant === "disabled") await completionOf(paths, "reflection-run-2", "failed", daysAgo(2))
      const dirs = await shape(paths)

      const report = await cap(paths, 1, variant === "disabled" ? { reflectionEnabled: false } : {})

      expect(report.suspendedSince).toBeUndefined()
      expect(existsSync(dirs.never)).toBe(false)
      expect(existsSync(join(dirs.partly, "transcript.jsonl"))).toBe(false)
    }
  })
})

describe("runtime size cap: discard_unreflected_journals (LEAD D1: default off, B18)", () => {
  test("#given the default switch (off) #when the cap forces tiers 4 and 5 #then a 60-day never-reflected and a partly-reflected journal are kept and reported as the held remainder", async () => {
    const paths = await identity()
    const never = await journal(paths, "j-never-60d", "never", daysAgo(60))
    const partly = await journal(paths, "j-partly-60d", "partly", daysAgo(60))
    const fully = await journal(paths, "j-fully-60d", "fully", daysAgo(60))
    const heldBytes = (await measureTreeBytes(never)) + (await measureTreeBytes(join(partly, "transcript.jsonl")))

    const report = await cap(paths, 1, { policy: UNREFLECTED_DEFAULT })

    expect(report.kept["j-never-60d"]).toBe("unreflected-retention-off")
    expect(report.kept["j-partly-60d"]).toBe("unreflected-retention-off")
    expect(report.unreflectedHeldBytes).toBe(heldBytes)
    expect(existsSync(never)).toBe(true)
    expect(existsSync(join(partly, "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(fully, "transcript.jsonl"))).toBe(false)
  })

  test("#given the switch on #when the cap forces tiers 4 and 5 #then the 60-day never-reflected journal is evicted", async () => {
    const paths = await identity()
    const never = await journal(paths, "j-never-60d", "never", daysAgo(60))

    const report = await cap(paths, 1, { policy: UNREFLECTED_ON })

    expect(report.evicted.map((entry) => entry.name)).toEqual(["j-never-60d"])
    expect(report.unreflectedHeldBytes).toBe(0)
    expect(existsSync(never)).toBe(false)
  })
})

describe("runtime size cap: pass budget and cursor (B16, H4; r3 N8, N3)", () => {
  // A stepping timer: every read advances 10 ms, so the budget is spent by reads, not by wall time.
  function steppingClock(stepMs: number): () => number {
    let reads = 0
    return () => (reads++) * stepMs
  }

  test("#given 40 evictions needed and a budget that allows 15 #when the cap runs twice #then the first stops with a tier cursor and the resumed walk finishes", async () => {
    const paths = await identity()
    const runs = await foldedRuns(paths, 42, 1024)
    await settleGuard(paths)
    const maxBytes = (await measureRuntimeSize(paths.runtime)).bytes - (await bytesOf(paths, runs.slice(0, 40)))

    const first = await cap(paths, maxBytes, { budgetMs: 160, clock: steppingClock(10) })

    expect(first.evicted).toHaveLength(15)
    expect(first.cursor?.store).toBe("cap")
    expect(first.cursor?.tier).toBe("folded-run")
    expect(first.cursor?.lastName).toBe(runs[14])
    expect(first.exceededBytes).toBeGreaterThan(0)

    const second = await cap(paths, maxBytes, { resume: first.cursor })

    expect(second.cursor).toBeUndefined()
    expect(second.evicted.map((entry) => entry.name)).toEqual(runs.slice(15, 40))
    expect(second.afterBytes).toBeLessThanOrEqual(maxBytes)
  })

  test("#given a measurement walk longer than the budget #when the cap runs #then it evicts nothing, writes no cursor and records measure-over-budget", async () => {
    const paths = await identity()
    await foldedRuns(paths, 4)

    const report = await cap(paths, 1, { budgetMs: 500, clock: steppingClock(1000) })

    expect(report.evicted).toEqual([])
    expect(report.cursor).toBeUndefined()
    expect(report.skipped).toContain("measure-over-budget")
  })

  test("#given the caller's measurement deadline has fired #when the cap runs #then it evicts nothing and records measure-over-budget", async () => {
    const paths = await identity()
    const runs = await foldedRuns(paths, 4)

    const report = await cap(paths, 1, { budgetMs: 60_000, measureSignal: AbortSignal.abort() })

    expect(report.evicted).toEqual([])
    expect(report.cursor).toBeUndefined()
    expect(report.skipped).toContain("measure-over-budget")
    expect(await liveNames(runsDir(paths))).toEqual(runs.toSorted())
  })

  test("#given the caller's signal aborts during the measurement walk #when the cap runs #then it rejects with the abort instead of recording measure-over-budget (#12538 review L3)", async () => {
    const paths = await identity()
    const runs = await foldedRuns(paths, 4)
    const caller = new AbortController()
    // The first clock read starts the measurement walk; the caller is disposed right there.
    const clock = () => {
      caller.abort()
      return 0
    }

    await expect(cap(paths, 1, { signal: caller.signal, measureSignal: caller.signal, budgetMs: 60_000, clock })).rejects.toMatchObject({ name: "AbortError" })
    expect(await liveNames(runsDir(paths))).toEqual(runs.toSorted())
  })

  test("#given an identity under its cap #when the cap runs #then it writes nothing under runtime/", async () => {
    const paths = await identity()
    await foldedRuns(paths, 2)
    const before = (await readdir(paths.runtime, { recursive: true })).sort()

    const report = await cap(paths, Number.MAX_SAFE_INTEGER)

    expect(report.evicted).toEqual([])
    expect((await readdir(paths.runtime, { recursive: true })).sort()).toEqual(before)
  })
})

describe("runtime size cap: what the next pass could evict, for the doctors (#12538 review M1)", () => {
  test("#given folded runs and a never-reflected journal with the default switch #when the evictable bytes are measured #then they count the folded runs below the newest and nothing under runtime/ changes", async () => {
    const paths = await identity()
    const runs = await foldedRuns(paths, 4)
    await journal(paths, "j-never", "never", daysAgo(60))
    const before = (await readdir(paths.runtime, { recursive: true })).sort()

    const evictable = await measureRuntimeCapEvictableBytes({ paths, policy: UNREFLECTED_DEFAULT, now })

    expect(evictable).toBe(await bytesOf(paths, runs.slice(0, 3)))
    expect((await readdir(paths.runtime, { recursive: true })).sort()).toEqual(before)
  })

  test("#given only the newest folded run and a never-reflected journal with the default switch #when the evictable bytes are measured #then nothing is evictable", async () => {
    const paths = await identity()
    await foldedRuns(paths, 1)
    await journal(paths, "j-never", "never", daysAgo(60))

    expect(await measureRuntimeCapEvictableBytes({ paths, policy: UNREFLECTED_DEFAULT, now })).toBe(0)
  })
})

describe("runtime retention then cap in one pass (B12 on)", () => {
  test("#given a scaled busiest-identity shape #when the pass runs with a cap #then retention frees the old data first and the cap evicts only tier 1", async () => {
    const paths = await identity()
    for (const [runId, days] of [["reflection-run-1", 12], ["reflection-run-2", 9]] as const) {
      await padded(await reflectionRun(paths, runId, { finishedAt: daysAgo(days) }), 64 * 1024, daysAgo(days))
    }
    const young: string[] = []
    for (let index = 3; index <= 7; index += 1) {
      const runId = `reflection-run-${index}`
      const finishedAt = daysAgo(8 - index) - index
      await padded(await reflectionRun(paths, runId, { finishedAt }), 64 * 1024, finishedAt)
      young.push(runId)
    }
    await journal(paths, "j-abandoned", "never", daysAgo(15))
    await journal(paths, "j-partly", "partly", daysAgo(15))
    const freshJournal = await journal(paths, "j-fresh", "never", daysAgo(3))
    const freshSidecar = await sidecar(paths, "fresh", daysAgo(1))
    const afterRetention = (await measureRuntimeSize(paths.runtime)).bytes
      - (await bytesOf(paths, ["reflection-run-1", "reflection-run-2"]))
      - (await measureTreeBytes(join(paths.transcripts, "j-abandoned")))
      - (await measureTreeBytes(join(paths.transcripts, "j-partly", "transcript.jsonl")))
    const margin = Math.floor((await bytesOf(paths, young.slice(2, 3))) / 2)
    const maxBytes = afterRetention - (await bytesOf(paths, young.slice(0, 2))) + margin

    const report = await runRuntimeRetention({ paths, policy: UNREFLECTED_ON, now, maxBytes })

    expect(report.runs.removed).toEqual(["reflection-run-1", "reflection-run-2"])
    expect([...report.journals.removed].sort()).toEqual(["j-abandoned", "j-partly"])
    expect(report.cap?.evicted.map((entry) => [entry.tier, entry.name])).toEqual(young.slice(0, 2).map((runId) => ["folded-run", runId]))
    expect(report.cap?.afterBytes).toBeLessThanOrEqual(maxBytes)
    expect(existsSync(freshJournal)).toBe(true)
    expect(existsSync(freshSidecar)).toBe(true)
  })
})

const TIER_ORDER = [
  "folded-run",
  "fully-reflected-transcript",
  "sidecar",
  "never-reflected-journal",
  "partly-reflected-transcript",
  "unfolded-run",
] as const


describe("runtime retention then cap with the default switch (B12 default, off)", () => {
  test("#given discard_unreflected_journals off #when retention and the cap run #then unreflected journals are kept and the cap evicts folded runs only", async () => {
    const paths = await identity()
    for (let index = 1; index <= 4; index += 1) {
      const finishedAt = daysAgo(5 - index)
      await padded(await reflectionRun(paths, `reflection-run-${index}`, { finishedAt }), 64 * 1024, finishedAt)
    }
    const abandoned = await journal(paths, "j-abandoned", "never", daysAgo(15))
    const partly = await journal(paths, "j-partly", "partly", daysAgo(15))

    const report = await runRuntimeRetention({ paths, policy: UNREFLECTED_DEFAULT, now, maxBytes: 1 })

    expect(report.journals.removed).toEqual([])
    expect(report.cap?.evicted.map((entry) => entry.tier)).toEqual(["folded-run", "folded-run", "folded-run"])
    expect(existsSync(abandoned)).toBe(true)
    expect(existsSync(join(partly, "transcript.jsonl"))).toBe(true)
  })
})
