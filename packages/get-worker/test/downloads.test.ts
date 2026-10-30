import { describe, expect, test } from "bun:test"
import { readDownloadStats } from "../src/download-stats"
import { parseRollupRows, RollupError, rollupQuery, rowsFrom, runDownloadsRollup } from "../src/downloads-rollup"
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

describe("the rollup's first day (account move, 2026-10-09)", () => {
  test("rows before ROLLUP_FIRST_DAY are never written, so a day completed by the backfill keeps its count", async () => {
    const { db, sqlite } = sqliteD1(migration)
    const h = harness(db)
    sqlite.run("INSERT INTO downloads_daily (day, kind, source, version, asset, count) VALUES ('2026-10-09', 'binary', 'r2', '5.1.1', 'omo-linux-x64', 500)")
    const env = { ...h.ctx.env, ROLLUP_FIRST_DAY: "2026-10-10" }
    const written = await runDownloadsRollup(env, (async () => Response.json({ data: [row("r2", 30, "2026-10-09"), row("r2", 12, "2026-10-10")] })) as unknown as typeof fetch)
    expect(written).toBe(1)
    const rows = sqlite.query("SELECT day, count FROM downloads_daily ORDER BY day").all()
    expect(rows).toEqual([
      { day: "2026-10-09", count: 500 },
      { day: "2026-10-10", count: 12 },
    ])
  })

  test("without a first day every row is written, as before", () => {
    const rows = parseRollupRows({ data: [row("r2", 1, "2026-10-08"), row("r2", 2, "2026-10-10")] })
    expect(rowsFrom(rows, undefined)).toHaveLength(2)
    expect(rowsFrom(rows, "")).toHaveLength(2)
  })

  test("a malformed first day stops the rollup before it queries anything", async () => {
    const { db } = sqliteD1(migration)
    const h = harness(db)
    let queried = false
    const fetcher = (async () => {
      queried = true
      return Response.json({ data: [] })
    }) as unknown as typeof fetch
    await expect(runDownloadsRollup({ ...h.ctx.env, ROLLUP_FIRST_DAY: "10/10/2026" }, fetcher)).rejects.toThrow("ROLLUP_FIRST_DAY")
    expect(queried).toBe(false)
  })

  test("the deployed config sets the first day to 2026-10-10 and runs the rollup hourly at :17", async () => {
    const config = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text()
    expect(config).toContain('"ROLLUP_FIRST_DAY": "2026-10-10"')
    expect(config).toContain('"triggers": { "crons": ["17 * * * *"] }')
  })
})
