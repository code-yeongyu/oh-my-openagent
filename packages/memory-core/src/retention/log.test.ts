import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { runRuntimeRetention } from "./pass"
import { DEFAULT_RUNTIME_RETENTION } from "./policy"
import { RETENTION_LOG_FILE, RETENTION_LOG_PREVIOUS_FILE, appendRetentionLog, readLastRetentionLogEntry } from "./log"
import { NOW, cleanupRoots, daysAgo, identity, iso, now, reflectionRun } from "./retention.test-support"

afterEach(cleanupRoots)

async function logLines(runtimeDir: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(join(runtimeDir, RETENTION_LOG_FILE), "utf8")
  return raw
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("retention removal log (#12932)", () => {
  test("#given a folded run past the window #when the pass removes it #then one log line names it, with the pass time and the total", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-1", { finishedAt: daysAgo(8) })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    await runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now })

    expect(existsSync(join(paths.reflection, "runs", "reflection-run-1"))).toBe(false)
    const lines = await logLines(paths.runtime)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ v: 1, at: iso(NOW), total: 1, removed: { runs: ["reflection-run-1"] } })
  })

  test("#given nothing past the window #when the pass runs #then no log file is written", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    await runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now })

    expect(existsSync(join(paths.runtime, RETENTION_LOG_FILE))).toBe(false)
  })

  test("#given a log past its size limit #when the next entry is appended #then the old log becomes the previous file and the new log holds only that entry", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    const old = `${JSON.stringify({ v: 1, at: iso(daysAgo(3)), total: 1, removed: { runs: ["reflection-run-0"] } })}\n`
    await writeFile(join(paths.runtime, RETENTION_LOG_FILE), old.repeat(40))

    await appendRetentionLog(paths.runtime, { at: NOW, removed: { journals: ["s-1"] } }, { maxBytes: 1024 })

    expect(await readFile(join(paths.runtime, RETENTION_LOG_PREVIOUS_FILE), "utf8")).toBe(old.repeat(40))
    expect(await logLines(paths.runtime)).toEqual([{ v: 1, at: iso(NOW), total: 1, removed: { journals: ["s-1"] } }])
  })

  test("#given one store removed more names than an entry lists #when it is appended #then the entry lists the cap and counts the rest", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    const runs = Array.from({ length: 7 }, (_, index) => `reflection-run-${index + 1}`)

    await appendRetentionLog(paths.runtime, { at: NOW, removed: { runs } }, { maxNamesPerStore: 5 })

    expect(await logLines(paths.runtime)).toEqual([
      { v: 1, at: iso(NOW), total: 7, removed: { runs: runs.slice(0, 5) }, more: { runs: 2 } },
    ])
  })

  test("#given a small entry then a cleanup naming 200 long names in each of 6 stores #when the last entry is read #then it is the newest one and its line fits the reader's tail (#12949 review M2)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    await appendRetentionLog(paths.runtime, { at: daysAgo(1), removed: { runs: ["reflection-run-1"] } })
    const names = (store: string) =>
      Array.from({ length: 200 }, (_, index) => `${store}-${"x".repeat(56)}-${String(index).padStart(3, "0")}`)
    const removed = Object.fromEntries(
      ["runs", "journals", "sidecars", "cap:runs", "cap:journals", "cap:sidecars"].map((store) => [
        store,
        names(store),
      ]),
    )

    await appendRetentionLog(paths.runtime, { at: NOW, removed })

    expect(await readLastRetentionLogEntry(paths.runtime)).toEqual({ at: iso(NOW), total: 1200 })
    const last = (await readFile(join(paths.runtime, RETENTION_LOG_FILE), "utf8")).trimEnd().split("\n").at(-1) ?? ""
    expect(Buffer.byteLength(last)).toBeLessThanOrEqual(32 * 1024)
  })

  test("#given a current log, a rotated log, a torn last line or no log #when the last entry is read #then it is the newest whole entry, else undefined", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    expect(await readLastRetentionLogEntry(paths.runtime)).toBeUndefined()

    await writeFile(
      join(paths.runtime, RETENTION_LOG_PREVIOUS_FILE),
      `${JSON.stringify({ v: 1, at: iso(daysAgo(9)), total: 4, removed: {} })}\n`,
    )
    expect(await readLastRetentionLogEntry(paths.runtime)).toEqual({ at: iso(daysAgo(9)), total: 4 })

    const first = JSON.stringify({ v: 1, at: iso(daysAgo(2)), total: 3, removed: {} })
    await writeFile(join(paths.runtime, RETENTION_LOG_FILE), `${first}\n{"v":1,"at":"2026-11-0`)
    expect(await readLastRetentionLogEntry(paths.runtime)).toEqual({ at: iso(daysAgo(2)), total: 3 })
  })
})
