import { describe, expect, test } from "bun:test"
import { readDownloadStats } from "../src/download-stats"
import { parseRollupRows, RollupError, rollupQuery, runDownloadsRollup } from "../src/downloads-rollup"
import { route } from "../src/index"
import { harness, sqliteD1 } from "./fakes"

const migration = await Bun.file(new URL("../migrations/0001_downloads.sql", import.meta.url)).text()

const row = (source: string, count: number, day = "2026-09-29", kind = "binary") => ({
  day,
  kind,
  source,
  version: "5.1.1",
  asset: "omo-linux-x64",
  count: String(count),
})

describe("rollup query", () => {
  test("covers whole UTC days only and weights by the sample interval", () => {
    const sql = rollupQuery("omo_downloads")
    expect(sql).toContain("toStartOfDay(NOW() - INTERVAL '6' DAY)")
    expect(sql).toContain("SUM(_sample_interval * double1)")
    expect(sql).toContain("blob6 != 'qa'")
    expect(() => rollupQuery("omo; DROP TABLE x")).toThrow(RollupError)
  })

  test("rejects a malformed Analytics Engine payload instead of storing zeros", () => {
    expect(() => parseRollupRows({ meta: [] })).toThrow(RollupError)
    expect(() => parseRollupRows({ data: [{ ...row("r2", 1), day: "yesterday" }] })).toThrow(RollupError)
  })
})

describe("rollup into D1 and the public stats", () => {
  test("upserts per day so an hourly rerun replaces counts instead of adding them", async () => {
    const { db } = sqliteD1(migration)
    const h = harness(db)
    const answer = (rows: unknown[]) => (async () => Response.json({ data: rows })) as unknown as typeof fetch
    await runDownloadsRollup(h.ctx.env, answer([row("r2", 3), row("cache", 5), row("github", 2)]))
    await runDownloadsRollup(h.ctx.env, answer([row("r2", 4), row("cache", 5), row("github", 2)]))
    const stats = await readDownloadStats(db)
    expect(stats).toEqual({
      servedFromMirror: 9,
      redirectedToGitHub: 2,
      adjustments: 0,
      uncountedByGitHub: 9,
      rolledUpThrough: "2026-09-29",
    })
  })

  test("GitHub redirects never add to the uncounted total and adjustments subtract QA installs", async () => {
    const { db, sqlite } = sqliteD1(migration)
    const h = harness(db)
    await runDownloadsRollup(h.ctx.env, (async () => Response.json({ data: [row("r2", 6), row("github", 40), row("r2", 9, "2026-09-29", "engine")] })) as unknown as typeof fetch)
    sqlite.run("INSERT INTO download_adjustments (delta, reason) VALUES (-4, 'qa installs')")
    const stats = await readDownloadStats(db)
    expect(stats.servedFromMirror).toBe(6)
    expect(stats.uncountedByGitHub).toBe(2)
    const response = await route(new Request("https://get.omo.dev/stats/downloads"), h.ctx)
    expect(await response.json()).toMatchObject({ uncountedByGitHub: 2, redirectedToGitHub: 40 })
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300")
  })

  test("a failed Analytics Engine call leaves the stored counts untouched", async () => {
    const { db } = sqliteD1(migration)
    const h = harness(db)
    await runDownloadsRollup(h.ctx.env, (async () => Response.json({ data: [row("r2", 7)] })) as unknown as typeof fetch)
    const failing = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch
    await expect(runDownloadsRollup(h.ctx.env, failing)).rejects.toThrow("Analytics Engine SQL returned 403")
    expect((await readDownloadStats(db)).servedFromMirror).toBe(7)
  })
})
