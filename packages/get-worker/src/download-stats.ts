import type { RequestContext } from "./env"

const STATS_TTL_SECONDS = 300

export interface DownloadStats {
  readonly servedFromMirror: number
  readonly redirectedToGitHub: number
  readonly adjustments: number
  /** Installs GitHub's download_count never sees: mirror-served binaries plus signed adjustments. */
  readonly uncountedByGitHub: number
  readonly rolledUpThrough: string | null
}

interface SourceRow {
  readonly source: string
  readonly total: number
}

export async function readDownloadStats(db: D1Database): Promise<DownloadStats> {
  const [bySource, adjustment, latest] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT source, SUM(count) AS total FROM downloads_daily WHERE kind = 'binary' GROUP BY source"),
    db.prepare("SELECT COALESCE(SUM(delta), 0) AS total FROM download_adjustments"),
    db.prepare("SELECT MAX(day) AS day FROM downloads_daily"),
  ])
  const rows: SourceRow[] = (bySource?.results ?? []).flatMap((row) => {
    const source = row.source
    const total = row.total
    return typeof source === "string" && typeof total === "number" ? [{ source, total }] : []
  })
  const sum = (sources: readonly string[]) =>
    rows.filter((row) => sources.includes(row.source)).reduce((acc, row) => acc + row.total, 0)
  const adjustmentTotal = adjustment?.results[0]?.total
  const adjustments = typeof adjustmentTotal === "number" ? adjustmentTotal : 0
  const servedFromMirror = sum(["r2", "cache"])
  const day = latest?.results[0]?.day
  return {
    servedFromMirror,
    redirectedToGitHub: sum(["github"]),
    adjustments,
    uncountedByGitHub: Math.max(0, servedFromMirror + adjustments),
    rolledUpThrough: typeof day === "string" ? day : null,
  }
}

export async function serveDownloadStats(ctx: RequestContext): Promise<Response> {
  const cacheKey = new Request("https://get.omo.dev/stats/downloads", { method: "GET" })
  const cached = await ctx.cache.match(cacheKey)
  if (cached !== undefined) return cached
  const stats = await readDownloadStats(ctx.env.DB)
  const response = Response.json(stats, {
    headers: {
      "Cache-Control": `public, max-age=${STATS_TTL_SECONDS}`,
      "Access-Control-Allow-Origin": "*",
    },
  })
  ctx.waitUntil(ctx.cache.put(cacheKey, response.clone()))
  return response
}
