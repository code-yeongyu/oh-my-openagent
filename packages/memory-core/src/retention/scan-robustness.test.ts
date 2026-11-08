import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { MemoryIdentityPaths } from "../identity/layout"
import { withLocalJournalLock, type JournalLock } from "../journal/lock"
import { readReflectionRetentionGuard } from "./guard"
import { measureRuntimeCapEvictableBytes, runRuntimeSizeCap, type RuntimeCapCursor, type RuntimeSizeCapOptions } from "./cap"
import { countRuntimePastRetention, measureUnreflectedJournalBytes } from "./past-retention"
import { runRuntimeRetention } from "./pass"
import { DEFAULT_RUNTIME_RETENTION } from "./policy"
import { ageTree, cleanupRoots, daysAgo, identity, journal, now, reflectionRun, runsDir, writeJson } from "./retention.test-support"
import { measureRuntimeSize } from "./size"

afterEach(cleanupRoots)
// Real run dirs and journals on a loaded shared host; the bound is a breaker, not a wait.
setDefaultTimeout(30_000)

const UNREFLECTED_ON = { ...DEFAULT_RUNTIME_RETENTION, abandonedJournalDays: 14, discardUnreflectedJournals: true }

function cap(paths: MemoryIdentityPaths, maxBytes: number, extra: Partial<RuntimeSizeCapOptions> = {}) {
  return runRuntimeSizeCap({ paths, policy: UNREFLECTED_ON, maxBytes, now, ...extra })
}

async function foldedRuns(paths: MemoryIdentityPaths, count: number, bytes: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 1; index <= count; index += 1) {
    const runId = `reflection-run-${index}`
    const finishedAt = daysAgo(count - index + 1) + index
    const dir = await reflectionRun(paths, runId, { outcome: "merged", finishedAt })
    await writeFile(join(dir, "padding.bin"), Buffer.alloc(bytes, 1))
    await ageTree(dir, finishedAt)
    ids.push(runId)
  }
  return ids
}

/** A stray plain file and a journal whose state.json is a directory, beside one good journal. */
async function badJournalEntries(paths: MemoryIdentityPaths): Promise<void> {
  await mkdir(paths.transcripts, { recursive: true })
  await writeFile(join(paths.transcripts, ".DS_Store"), "x")
  await mkdir(join(paths.transcripts, "j-torn", "state.json"), { recursive: true })
  await writeFile(join(paths.transcripts, "j-torn", "transcript.jsonl"), "{}\n")
}

describe("runtime cap and doctor scans tolerate one bad journal entry (#12538 review r3 M1)", () => {
  test("#given a stray file and an unreadable state.json under transcripts #when the cap forces the journal tiers #then it keeps the torn journal as state-unreadable and still evicts the good one", async () => {
    const paths = await identity()
    await foldedRuns(paths, 2, 1024)
    const good = await journal(paths, "j-fully", "fully", daysAgo(60))
    await badJournalEntries(paths)

    const report = await cap(paths, 1)

    expect(report.kept["j-torn"]).toBe("state-unreadable")
    expect(report.evicted.map((entry) => entry.name)).toContain("j-fully")
    expect(await Bun.file(join(good, "transcript.jsonl")).exists()).toBe(false)
  })

  test("#given the same bad entries #when the doctors' scans run #then the evictable bytes, the unreflected bytes and the past-retention count all resolve", async () => {
    const paths = await identity()
    await foldedRuns(paths, 2, 1024)
    await journal(paths, "j-never", "never", daysAgo(60))
    await badJournalEntries(paths)

    expect(await measureRuntimeCapEvictableBytes({ paths, policy: UNREFLECTED_ON, now })).toBeGreaterThan(0)
    expect(await measureUnreflectedJournalBytes({ paths, policy: UNREFLECTED_ON })).toBeGreaterThan(0)
    expect((await countRuntimePastRetention({ paths, policy: UNREFLECTED_ON, now })).journals).toBe(1)
  })
})

describe("the doctors' journal measures run under the measurement deadline (#12538 review r3 M2)", () => {
  test("#given a fired deadline #when the unreflected bytes and the evictable bytes are measured #then both reject with the abort instead of reading every transcript", async () => {
    const paths = await identity()
    await foldedRuns(paths, 2, 1024)
    await journal(paths, "j-never", "never", daysAgo(60))

    await expect(measureUnreflectedJournalBytes({ paths, policy: UNREFLECTED_ON, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" })
    await expect(measureRuntimeCapEvictableBytes({ paths, policy: UNREFLECTED_ON, now, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("the cap classifies journals only when it reaches their tier (#12538 review r3 L1)", () => {
  test("#given folded runs enough to fit #when the cap runs #then no journal is looked at", async () => {
    const paths = await identity()
    const runs = await foldedRuns(paths, 4, 256 * 1024)
    await journal(paths, "j-fully", "fully", daysAgo(60))
    await badJournalEntries(paths)
    await readReflectionRetentionGuard({ paths, policy: UNREFLECTED_ON, now })
    const looked: string[] = []
    const maxBytes = (await measureRuntimeSize(paths.runtime)).bytes - 200 * 1024

    const report = await cap(paths, maxBytes, { isLiveSession: (sessionId) => (looked.push(sessionId), false) })

    expect(report.evicted.map((entry) => entry.name)).toEqual([runs[0]])
    expect(looked).toEqual([])
  })
})

describe("a resumed cap pass that walks no new item keeps its cursor (#12538 review r3 L2)", () => {
  const resume: RuntimeCapCursor = { store: "cap", tier: "folded-run", clock: 0, lastName: "reflection-run-0" }

  test("#given a stored cap cursor #when the measurement walk runs over the budget #then the cursor is returned unchanged", async () => {
    const paths = await identity()
    await foldedRuns(paths, 4, 1024)
    let reads = 0
    const report = await cap(paths, 1, { resume, budgetMs: 500, clock: () => (reads++) * 1000 })

    expect(report.skipped).toContain("measure-over-budget")
    expect(report.cursor).toEqual(resume)
  })

  test("#given a stored cap cursor #when the deadline passes before the first new item #then the cursor is returned unchanged", async () => {
    const paths = await identity()
    await foldedRuns(paths, 4, 1024)
    await readReflectionRetentionGuard({ paths, policy: UNREFLECTED_ON, now })
    // Reads 0 and 1 frame the measurement walk (1 ms, inside the budget); the first item's check is past it.
    let reads = 0
    const report = await cap(paths, 1, { resume, budgetMs: 5, clock: () => [0, 1][reads++] ?? 1000 })

    expect(report.evicted).toEqual([])
    expect(report.cursor).toEqual(resume)
  })
})

const cursorFile = (paths: MemoryIdentityPaths): string => join(paths.runtime, "retention.json")

async function persistedCursors(paths: MemoryIdentityPaths): Promise<{ readonly cursor?: unknown; readonly cap?: unknown } | undefined> {
  if (!existsSync(cursorFile(paths))) return undefined
  return JSON.parse(await readFile(cursorFile(paths), "utf8")) as { readonly cursor?: unknown; readonly cap?: unknown }
}

async function liveRuns(paths: MemoryIdentityPaths): Promise<string[]> {
  return (await readdir(runsDir(paths))).filter((name) => !name.startsWith(".prune-")).sort()
}

/** 13 failed runs 60..48 days old: retention never removes them, the cap's tier 6 may evict the oldest 3. */
async function unfoldedRuns(paths: MemoryIdentityPaths): Promise<{ readonly runs: string[]; readonly at: number[] }> {
  const runs: string[] = []
  const at: number[] = []
  for (let index = 1; index <= 13; index += 1) {
    const finishedAt = daysAgo(61 - index)
    runs.push(await reflectionRun(paths, `reflection-run-${index}`, { outcome: "failed", finishedAt }).then(() => `reflection-run-${index}`))
    at.push(finishedAt)
  }
  return { runs, at }
}

describe("a saved cap resume point never stops retention (#12538 review r4 M)", () => {
  // A pass budget of 0 ms: one item per store walk is admitted, and the cap's size walk always overruns
  // what is left, so the cap never makes progress on its own.
  const ZERO_BUDGET = { ...UNREFLECTED_ON, passBudgetMs: 0 }

  test("#given an identity over its cap with a stored cap resume point and a size walk that overruns the budget #when passes repeat #then retention still removes the runs and the journal past their windows and the cap keeps its resume point", async () => {
    const paths = await identity()
    for (let index = 1; index <= 4; index += 1) await reflectionRun(paths, `reflection-run-${index}`, { finishedAt: daysAgo(60 - index) })
    const stale = await journal(paths, "j-fully", "fully", daysAgo(60))
    const resume: RuntimeCapCursor = { store: "cap", tier: "folded-run", clock: 0, lastName: "reflection-run-0" }
    // The shape a pass of #12538@237e8d01d1 persisted: the cap's resume point as the pass's only cursor.
    await writeJson(cursorFile(paths), { version: 1, cursor: resume })

    const capResumePoints: unknown[] = []
    for (let pass = 0; pass < 10; pass += 1) {
      await runRuntimeRetention({ paths, policy: ZERO_BUDGET, now, maxBytes: 1 })
      capResumePoints.push((await persistedCursors(paths))?.cap)
    }

    // The newest folded run (also the run-id high water) stays as the anchor.
    expect(await liveRuns(paths)).toEqual(["reflection-run-4"])
    expect(existsSync(join(stale, "transcript.jsonl"))).toBe(false)
    expect(capResumePoints).toEqual(Array.from({ length: 10 }, () => resume))
  })

  test("#given a stored store cursor and a stored cap resume point #when the pass runs with budget #then the store walk resumes at its cursor and the cap resumes its tier after its own resume point", async () => {
    const paths = await identity()
    const { runs, at } = await unfoldedRuns(paths)
    const [at0, at1] = at
    const [run0] = runs
    if (at0 === undefined || at1 === undefined || run0 === undefined) throw new Error("expected at least two unfolded runs")
    const resume: RuntimeCapCursor = { store: "cap", tier: "unfolded-run", clock: (at0 + at1) / 2, lastName: run0 }
    await writeJson(cursorFile(paths), { version: 1, cursor: { store: "journals", lastName: "s-05" }, cap: resume })

    const report = await runRuntimeRetention({ paths, policy: UNREFLECTED_ON, now, maxBytes: 1 })

    expect(report.cap?.evicted.map((entry) => entry.name)).toEqual([runs[1], runs[2]])
    expect(await liveRuns(paths)).toEqual([run0, ...runs.slice(3)].sort())
    expect(await persistedCursors(paths)).toBeUndefined()
  })

  test("#given a stored cap resume point #when a pass's cap makes no progress and the next pass has budget #then the first keeps the resume point and the second resumes there and completes", async () => {
    const paths = await identity()
    const { runs, at } = await unfoldedRuns(paths)
    const [at0, at1] = at
    const [run0] = runs
    if (at0 === undefined || at1 === undefined || run0 === undefined) throw new Error("expected at least two unfolded runs")
    const resume: RuntimeCapCursor = { store: "cap", tier: "unfolded-run", clock: (at0 + at1) / 2, lastName: run0 }
    await writeJson(cursorFile(paths), { version: 1, cap: resume })

    const stalled = await runRuntimeRetention({ paths, policy: ZERO_BUDGET, now, maxBytes: 1 })

    expect(stalled.cap?.skipped).toContain("measure-over-budget")
    expect(stalled.cap?.evicted).toEqual([])
    expect((await persistedCursors(paths))?.cap).toEqual(resume)

    const resumed = await runRuntimeRetention({ paths, policy: UNREFLECTED_ON, now, maxBytes: 1 })

    expect(resumed.cap?.evicted.map((entry) => entry.name)).toEqual([runs[1], runs[2]])
    expect(resumed.cap?.cursor).toBeUndefined()
    expect(await persistedCursors(paths)).toBeUndefined()
  })
})

describe("a journal that turns unreadable before the cap's locked eviction (#12538 review r4 L)", () => {
  test("#given a journal whose state.json becomes a directory after classification, as its lock is taken #when the cap evicts the journal tiers #then that journal is kept as state-unreadable and the next journal is still evicted", async () => {
    const paths = await identity()
    await foldedRuns(paths, 2, 1024)
    const race = await journal(paths, "j-race", "fully", daysAgo(60))
    const good = await journal(paths, "j-zz-good", "fully", daysAgo(60))
    const raced: string[] = []
    const journalLock: JournalLock = async (lockPath, task, signal) => {
      if (lockPath === join(race, "state.lock")) {
        raced.push(lockPath)
        await rm(join(race, "state.json"))
        await mkdir(join(race, "state.json"))
      }
      return withLocalJournalLock(lockPath, task, signal)
    }

    const report = await cap(paths, 1, { journalLock })

    expect(raced).toHaveLength(1)
    expect(report.kept["j-race"]).toBe("state-unreadable")
    expect(report.evicted.map((entry) => entry.name)).toContain("j-zz-good")
    expect(existsSync(join(good, "transcript.jsonl"))).toBe(false)
  })

  test("#given the caller aborts inside the journal lock of the cap's last candidate #when the cap evicts the journal tiers #then the cap rejects with the abort instead of keeping that journal as state-unreadable (#12538 review r5 L2)", async () => {
    const paths = await identity()
    await foldedRuns(paths, 2, 1024)
    const first = await journal(paths, "j-first", "fully", daysAgo(60))
    const last = await journal(paths, "j-zz-last", "fully", daysAgo(60))
    const controller = new AbortController()
    const locked: string[] = []
    const journalLock: JournalLock = async (lockPath, task, signal) => {
      locked.push(lockPath)
      if (lockPath === join(last, "state.lock")) {
        // The caller aborts while this candidate's lock is taken, and the lock reports it as a signal-aware lock does.
        controller.abort()
        controller.signal.throwIfAborted()
      }
      return withLocalJournalLock(lockPath, task, signal)
    }

    // A cap that kept the aborted journal as state-unreadable would resolve, and its pass could stamp itself complete.
    await expect(cap(paths, 1, { journalLock, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })

    expect(locked).toEqual([join(first, "state.lock"), join(last, "state.lock")])
    expect(existsSync(join(first, "transcript.jsonl"))).toBe(false)
    expect(existsSync(join(last, "transcript.jsonl"))).toBe(true)
  })
})
