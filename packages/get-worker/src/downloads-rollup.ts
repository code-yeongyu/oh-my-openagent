import type { Env } from "./env"

const ROLLUP_DAYS = 7
const DAY = /^\d{4}-\d{2}-\d{2}$/
const SAFE_DATASET = /^[A-Za-z0-9_]+$/

export interface RollupRow {
  readonly day: string
  readonly kind: string
  readonly source: string
  readonly version: string
  readonly asset: string
  readonly count: number
}

export class RollupError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "RollupError"
  }
}

// Only whole UTC days enter the window, so an upsert never replaces a finished day with a partial one.
// SUM(_sample_interval) restores the true count when Analytics Engine samples a busy dataset.
export function rollupQuery(dataset: string, days: number = ROLLUP_DAYS): string {
  if (!SAFE_DATASET.test(dataset)) throw new RollupError(`invalid dataset name ${dataset}`)
  return `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS day, blob1 AS kind, blob2 AS source, blob3 AS version, blob4 AS asset, SUM(_sample_interval * double1) AS count
FROM ${dataset}
WHERE timestamp >= toStartOfDay(NOW() - INTERVAL '${days - 1}' DAY) AND blob1 IN ('binary', 'checksums', 'engine') AND blob6 != 'qa'
GROUP BY day, kind, source, version, asset
FORMAT JSON`
}

export function parseRollupRows(payload: unknown): RollupRow[] {
  const data = typeof payload === "object" && payload !== null ? Reflect.get(payload, "data") : undefined
  if (!Array.isArray(data)) throw new RollupError("Analytics Engine response has no data array")
  return data.map((row: unknown) => {
    const field = (name: string) => (typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined)
    const day = field("day")
    const count = Number(field("count"))
    const text = (name: string) => {
      const value = field(name)
      if (typeof value !== "string") throw new RollupError(`Analytics Engine row has no ${name}`)
      return value
    }
    if (typeof day !== "string" || !DAY.test(day)) throw new RollupError("Analytics Engine row has no day")
    if (!Number.isFinite(count) || count < 0) throw new RollupError("Analytics Engine row has no count")
    return { day, kind: text("kind"), source: text("source"), version: text("version"), asset: text("asset"), count: Math.round(count) }
  })
}

export async function queryAnalytics(env: Env, fetcher: typeof fetch = fetch): Promise<RollupRow[]> {
  if (!env.ANALYTICS_TOKEN) throw new RollupError("ANALYTICS_TOKEN is not configured")
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ANALYTICS_TOKEN}` },
    body: rollupQuery(env.ANALYTICS_DATASET),
  })
  if (!response.ok) throw new RollupError(`Analytics Engine SQL returned ${response.status}`, response.status)
  return parseRollupRows(await response.json())
}

export async function storeRollup(db: D1Database, rows: readonly RollupRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const upsert = db.prepare(
    `INSERT INTO downloads_daily (day, kind, source, version, asset, count) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, kind, source, version, asset) DO UPDATE SET count = excluded.count`,
  )
  await db.batch(rows.map((row) => upsert.bind(row.day, row.kind, row.source, row.version, row.asset, row.count)))
  return rows.length
}

/**
 * Rows on or after ROLLUP_FIRST_DAY only. A day that started on another Cloudflare account (the 2026-10-09 move) is in
 * D1 from that account's rollup plus a one-time backfill; this account's Analytics Engine has only part of it, and an
 * upsert would replace the whole day with that part on every hourly run until it leaves the 7-day window.
 */
export function rowsFrom(rows: readonly RollupRow[], firstDay: string | undefined): RollupRow[] {
  if (firstDay === undefined || firstDay === "") return [...rows]
  if (!DAY.test(firstDay)) throw new RollupError(`ROLLUP_FIRST_DAY is not YYYY-MM-DD: ${firstDay}`)
  return rows.filter((row) => row.day >= firstDay)
}

export async function runDownloadsRollup(env: Env, fetcher: typeof fetch = fetch): Promise<number> {
  // Checked before the query, so a malformed floor never reaches Analytics Engine or D1.
  rowsFrom([], env.ROLLUP_FIRST_DAY)
  return storeRollup(env.DB, rowsFrom(await queryAnalytics(env, fetcher), env.ROLLUP_FIRST_DAY))
}
