const GITHUB_OWNER = "code-yeongyu"
const GITHUB_REPO = "oh-my-openagent"
// OmO shipped under three npm names in sequence; downloads are the sum of the lineage.
const NPM_PACKAGES = ["oh-my-opencode", "oh-my-openagent", "omo-ai"] as const
const NPM_FIRST_PUBLISH_YEAR = 2025

const CACHE_TTL_MS = 60 * 60 * 1000

export const FALLBACK_DESCRIPTION =
  'OmO: Just type "mass ulw" keyword with your prompt. Now you are the master of graph engineering.'

export const FALLBACK_STATS_DATA: StatsData = {
  stars: 69_000,
  description: FALLBACK_DESCRIPTION,
  totalDownloads: 3_800_000,
  monthlyDownloads: 200_000,
  weeklyDownloads: 36_000,
}

interface StatsCache {
  data: StatsData
  timestamp: number
}

export interface StatsData {
  stars: number
  description: string
  totalDownloads: number
  monthlyDownloads: number
  weeklyDownloads: number
}

export interface FormattedStatsData {
  readonly stars: string
  readonly description: string
  readonly totalDownloads: string
  readonly monthlyDownloads: string
  readonly weeklyDownloads: string
}

let cache: StatsCache | null = null

export function resetStatsCacheForTests(): void {
  cache = null
}

function formatCount(num: number): string {
  if (num >= 1_000_000) {
    const formatted = (num / 1_000_000).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}M+`
  }
  if (num >= 1_000) {
    const formatted = (num / 1_000).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}k`
  }
  return String(num)
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, next: { revalidate: 3600 } } as RequestInit)
  if (!res.ok) {
    throw new Error(`Upstream ${res.status} for ${url}`)
  }
  return res.json()
}

async function fetchGitHubStats(): Promise<Pick<StatsData, "stars" | "description">> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "omo-web",
  }

  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const data = await fetchJson(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`, {
    headers,
  })
  if (typeof data !== "object" || data === null) {
    throw new Error("GitHub repo payload is not an object")
  }
  const stars = Reflect.get(data, "stargazers_count")
  if (typeof stars !== "number") {
    throw new Error("GitHub repo payload has no stargazers_count")
  }
  const description = Reflect.get(data, "description")
  return {
    stars,
    description:
      typeof description === "string" && description.trim() ? description : FALLBACK_DESCRIPTION,
  }
}

function readDownloads(payload: unknown, context: string): number {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(`npm payload for ${context} is not an object`)
  }
  const downloads = Reflect.get(payload, "downloads")
  if (typeof downloads !== "number" || !Number.isFinite(downloads) || downloads < 0) {
    throw new Error(`npm payload for ${context} has no downloads count`)
  }
  return downloads
}

async function fetchPackageDownloads(range: string, pkg: string): Promise<number> {
  const payload = await fetchJson(`https://api.npmjs.org/downloads/point/${range}/${pkg}`)
  return readDownloads(payload, `${pkg}@${range}`)
}

async function sumPackages(range: string): Promise<number> {
  const counts = await Promise.all(NPM_PACKAGES.map((pkg) => fetchPackageDownloads(range, pkg)))
  return counts.reduce((sum, n) => sum + n, 0)
}

function yearRanges(now: Date): readonly string[] {
  const today = now.toISOString().slice(0, 10)
  const ranges: string[] = []
  for (let year = NPM_FIRST_PUBLISH_YEAR; year <= now.getFullYear(); year++) {
    const end = year === now.getFullYear() ? today : `${year}-12-31`
    ranges.push(`${year}-01-01:${end}`)
  }
  return ranges
}

async function fetchAllTimeDownloads(now: Date): Promise<number> {
  const perYear = await Promise.all(yearRanges(now).map((range) => sumPackages(range)))
  return perYear.reduce((sum, n) => sum + n, 0)
}

async function fetchFreshStats(now: Date): Promise<StatsData> {
  const [github, monthlyDownloads, weeklyDownloads, totalDownloads] = await Promise.all([
    fetchGitHubStats(),
    sumPackages("last-month"),
    sumPackages("last-week"),
    fetchAllTimeDownloads(now),
  ])
  return { ...github, totalDownloads, monthlyDownloads, weeklyDownloads }
}

/**
 * All-or-nothing: any failed sub-request rejects instead of contributing 0, so a partial
 * aggregate is never returned or cached. An expired cache is served when a refresh fails.
 */
export async function getStats(): Promise<StatsData> {
  const now = Date.now()

  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data
  }

  try {
    const data = await fetchFreshStats(new Date(now))
    cache = { data, timestamp: now }
    return data
  } catch (error) {
    if (cache) {
      console.warn("Stats refresh failed; serving last known-good values", error)
      return cache.data
    }
    throw error
  }
}

export function formatStats(stats: StatsData): FormattedStatsData {
  return {
    stars: formatCount(stats.stars),
    description: stats.description,
    totalDownloads: formatCount(stats.totalDownloads),
    monthlyDownloads: formatCount(stats.monthlyDownloads),
    weeklyDownloads: formatCount(stats.weeklyDownloads),
  }
}

export const FALLBACK_FORMATTED_STATS: FormattedStatsData = formatStats(FALLBACK_STATS_DATA)
