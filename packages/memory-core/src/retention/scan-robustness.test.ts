import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { MemoryIdentityPaths } from "../identity/layout"
import { readReflectionRetentionGuard } from "./guard"
import { measureRuntimeCapEvictableBytes, runRuntimeSizeCap, type RuntimeCapCursor, type RuntimeSizeCapOptions } from "./cap"
import { countRuntimePastRetention, measureUnreflectedJournalBytes } from "./past-retention"
import { DEFAULT_RUNTIME_RETENTION } from "./policy"
import { ageTree, cleanupRoots, daysAgo, identity, journal, now, reflectionRun } from "./retention.test-support"
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
