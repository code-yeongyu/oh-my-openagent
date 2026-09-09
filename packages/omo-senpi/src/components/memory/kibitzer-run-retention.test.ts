import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createThrottledPrune,
  pruneKibitzerRuns,
  writeKibitzerRunOutcome,
} from "./kibitzer-run-retention"

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const NOW = new Date("2026-09-07T00:00:00.000Z")
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tmp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omo-kibitzer-retention-"))
  roots.push(root)
  return root
}

async function seed(
  runsDir: string,
  name: string,
  ageMs: number,
  files: Record<string, string>,
): Promise<string> {
  const dir = join(runsDir, name)
  await mkdir(dir, { recursive: true })
  const at = new Date(NOW.getTime() - ageMs)
  for (const [file, body] of Object.entries(files)) {
    const path = join(dir, file)
    await writeFile(path, body)
    await utimes(path, at, at)
  }
  return dir
}

describe("writeKibitzerRunOutcome", () => {
  test("#given a completed status with nudged paths #when writeKibitzerRunOutcome runs #then outcome.json records them", async () => {
    const runDir = join(await tmp(), "run-1")
    await mkdir(runDir, { recursive: true })
    await writeKibitzerRunOutcome({
      runDir,
      runId: "run-1",
      status: "completed",
      nudged: ["notes/a.md"],
      now: () => NOW,
    })
    const parsed: unknown = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))
    expect(parsed).toEqual({
      version: 1,
      runId: "run-1",
      status: "completed",
      nudged: ["notes/a.md"],
      finishedAt: NOW.toISOString(),
    })
  })

  test("#given a model for a completed run #when writeKibitzerRunOutcome runs #then outcome.json records it", async () => {
    const runDir = join(await tmp(), "run-model")
    await writeKibitzerRunOutcome({
      runDir,
      runId: "run-model",
      status: "completed",
      model: "omo-mock/healthy-fallback",
      nudged: [],
      now: () => NOW,
    })
    const parsed: unknown = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))
    expect(parsed).toMatchObject({ version: 1, runId: "run-model", status: "completed", model: "omo-mock/healthy-fallback" })
  })

  test("#given a runDir that does not exist yet #when writeKibitzerRunOutcome runs #then it creates the directory and the file", async () => {
    const runDir = join(await tmp(), "run-x")
    expect(existsSync(runDir)).toBe(false)
    await writeKibitzerRunOutcome({
      runDir,
      runId: "run-x",
      status: "dropped",
      cause: "deadline",
      nudged: [],
      now: () => NOW,
    })
    expect(existsSync(join(runDir, "outcome.json"))).toBe(true)
    const parsed: unknown = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))
    expect(parsed).toMatchObject({
      version: 1,
      runId: "run-x",
      status: "dropped",
      cause: "deadline",
      nudged: [],
    })
  })
})

describe("pruneKibitzerRuns", () => {
  test("#given an 8-day-old dir with no outcome.json #when pruning #then the dir is removed", async () => {
    const recallDir = await tmp()
    await seed(join(recallDir, "runs"), "old", 8 * DAY, { "candidates.json": "{}\n" })
    const result = await pruneKibitzerRuns({ recallDir, now: () => NOW })
    expect(result).toEqual({ removed: 1, kept: 0 })
    expect(existsSync(join(recallDir, "runs", "old"))).toBe(false)
  })

  test("#given a 29-day-old nudged dir #when pruning at 29 then 31 days #then it is kept then removed", async () => {
    const recallDir = await tmp()
    const runsDir = join(recallDir, "runs")
    await seed(runsDir, "nudged", 29 * DAY, {
      "outcome.json": JSON.stringify({
        version: 1,
        runId: "nudged",
        status: "completed",
        nudged: ["notes/a.md"],
        finishedAt: NOW.toISOString(),
      }),
    })
    expect(await pruneKibitzerRuns({ recallDir, now: () => NOW })).toEqual({ removed: 0, kept: 1 })
    expect(existsSync(join(runsDir, "nudged"))).toBe(true)
    expect(await pruneKibitzerRuns({ recallDir, now: () => new Date(NOW.getTime() + 2 * DAY) })).toEqual({
      removed: 1,
      kept: 0,
    })
    expect(existsSync(join(runsDir, "nudged"))).toBe(false)
  })

  test("#given a dropped deadline dir #when pruning at 20 then 31 days #then it is kept then removed", async () => {
    const recallDir = await tmp()
    const runsDir = join(recallDir, "runs")
    await seed(runsDir, "deadline", 20 * DAY, {
      "outcome.json": JSON.stringify({
        version: 1,
        runId: "deadline",
        status: "dropped",
        cause: "deadline",
        nudged: [],
        finishedAt: NOW.toISOString(),
      }),
    })
    expect(await pruneKibitzerRuns({ recallDir, now: () => NOW })).toEqual({ removed: 0, kept: 1 })
    expect(existsSync(join(runsDir, "deadline"))).toBe(true)
    expect(await pruneKibitzerRuns({ recallDir, now: () => new Date(NOW.getTime() + 11 * DAY) })).toEqual({
      removed: 1,
      kept: 0,
    })
    expect(existsSync(join(runsDir, "deadline"))).toBe(false)
  })

  test("#given a 6-day-old failed dir #when pruning #then the dir is kept", async () => {
    const recallDir = await tmp()
    await seed(join(recallDir, "runs"), "failed", 6 * DAY, {
      "outcome.json": JSON.stringify({
        version: 1,
        runId: "failed",
        status: "failed",
        cause: "deadline",
        nudged: [],
        finishedAt: NOW.toISOString(),
      }),
    })
    expect(await pruneKibitzerRuns({ recallDir, now: () => NOW })).toEqual({ removed: 0, kept: 1 })
    expect(existsSync(join(recallDir, "runs", "failed"))).toBe(true)
  })

  test("#given a 400-day-old empty dir and an 8-day-old dir with a 1-minute-old file #when pruning #then the empty dir is removed and the fresh-file dir is kept", async () => {
    const recallDir = await tmp()
    const runsDir = join(recallDir, "runs")
    const emptyOld = join(runsDir, "empty-old")
    const oldFile = join(runsDir, "old-file")
    await mkdir(emptyOld, { recursive: true })
    await mkdir(oldFile, { recursive: true })
    await writeFile(join(oldFile, "candidates.json"), "{}\n")
    const ancient = new Date(NOW.getTime() - 400 * DAY)
    const eightDays = new Date(NOW.getTime() - 8 * DAY)
    const oneMinute = new Date(NOW.getTime() - 60_000)
    await utimes(emptyOld, ancient, ancient)
    await utimes(oldFile, eightDays, eightDays)
    await utimes(join(oldFile, "candidates.json"), oneMinute, oneMinute)
    const result = await pruneKibitzerRuns({ recallDir, now: () => NOW })
    expect(result).toEqual({ removed: 1, kept: 1 })
    expect(existsSync(emptyOld)).toBe(false)
    expect(existsSync(oldFile)).toBe(true)
  })

  test("#given a dir whose newest file is 1 minute old #when pruning #then the dir is skipped", async () => {
    const recallDir = await tmp()
    await seed(join(recallDir, "runs"), "fresh", 60_000, { "candidates.json": "{}\n" })
    expect(await pruneKibitzerRuns({ recallDir, now: () => NOW })).toEqual({ removed: 0, kept: 1 })
    expect(existsSync(join(recallDir, "runs", "fresh"))).toBe(true)
  })

  test("#given a stale .prune-x tombstone #when pruning #then the tombstone is removed", async () => {
    const recallDir = await tmp()
    const tombstone = join(recallDir, "runs", ".prune-x")
    await mkdir(tombstone, { recursive: true })
    await writeFile(join(tombstone, "leftover.txt"), "x\n")
    await pruneKibitzerRuns({ recallDir, now: () => NOW })
    expect(existsSync(tombstone)).toBe(false)
  })

  test("#given a remove seam that throws ENOENT #when pruning #then it does not throw", async () => {
    const recallDir = await tmp()
    await seed(join(recallDir, "runs"), "old", 8 * DAY, { "candidates.json": "{}\n" })
    const error = new Error("missing")
    Object.assign(error, { code: "ENOENT" })
    await expect(pruneKibitzerRuns({
      recallDir,
      now: () => NOW,
      remove: async () => { throw error },
    })).resolves.toMatchObject({ kept: 0 })
  })
})

describe("createThrottledPrune", () => {
  test("#given a throttled prune #when called twice within an hour then after the interval #then the second call is skipped and the later call runs", async () => {
    const recallDir = await tmp()
    let calls = 0
    let resume = (): void => undefined
    const prune = async () => {
      calls += 1
      resume()
      return { removed: 0, kept: 0 }
    }
    let current = NOW.getTime()
    const tick = createThrottledPrune({
      recallDir,
      now: () => new Date(current),
      intervalMs: HOUR,
      prune,
    })
    const first = new Promise<void>((resolve) => { resume = resolve })
    tick()
    await first
    await Promise.resolve()
    expect(calls).toBe(1)
    tick()
    expect(calls).toBe(1)
    current += HOUR + 1
    const later = new Promise<void>((resolve) => { resume = resolve })
    tick()
    await later
    expect(calls).toBe(2)
  })
})
