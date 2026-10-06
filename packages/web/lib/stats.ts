import { GITHUB_REPOSITORY, githubHeaders } from "./github"
import {
  fetchInstallerDownloads,
  resetInstallerDownloadsCacheForTests,
} from "./installer-downloads"
import { fetchNativeDownloads, resetNativeDownloadsCacheForTests } from "./native-downloads"
import { fetchAllTimeDownloads, sumLineageDownloads } from "./npm-downloads"

const CACHE_TTL_MS = 60 * 60 * 1000

export const FALLBACK_DESCRIPTION =
  'OmO: Just type "mass ulw" keyword with your prompt. Now you are the master of graph engineering.'

export const FALLBACK_STATS_DATA: StatsData = {
  stars: 69_000,
  description: FALLBACK_DESCRIPTION,
  totalDownloads: 3_800_000,
  npmTotalDownloads: 3_800_000,
  nativeDownloads: 0,
  installerDownloads: 0,
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
  /** npm lineage plus the compiled binaries downloaded from GitHub releases and the get.omo.dev mirror. */
  totalDownloads: number
  npmTotalDownloads: number
  nativeDownloads: number
  installerDownloads: number
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
  resetNativeDownloadsCacheForTests()
  resetInstallerDownloadsCacheForTests()
}

function formatCount(num: number): string {
  if (num >= 1_000_000) {
    const formatted = (Math.floor(num / 100_000) / 10).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}M+`
  }
  if (num >= 1_000) {
    const formatted = (num / 1_000).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}k`
  }
  return String(num)
}

const REVALIDATE_HOURLY = { next: { revalidate: 3600 } } as RequestInit

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, ...REVALIDATE_HOURLY })
  if (!res.ok) {
    throw new Error(`Upstream ${res.status} for ${url}`)
  }
  return res.json()
}

async function fetchGitHubStats(): Promise<Pick<StatsData, "stars" | "description">> {
  const data = await fetchJson(`https://api.github.com/repos/${GITHUB_REPOSITORY}`, {
    headers: githubHeaders(),
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

async function fetchFreshStats(now: Date): Promise<StatsData> {
  const [
    github,
    monthlyDownloads,
    weeklyDownloads,
    npmTotalDownloads,
    nativeDownloads,
    installerDownloads,
  ] = await Promise.all([
    fetchGitHubStats(),
    sumLineageDownloads("last-month", REVALIDATE_HOURLY),
    sumLineageDownloads("last-week", REVALIDATE_HOURLY),
    fetchAllTimeDownloads(now, REVALIDATE_HOURLY),
    fetchNativeDownloads(REVALIDATE_HOURLY),
    fetchInstallerDownloads(REVALIDATE_HOURLY),
  ])
  return {
    ...github,
    totalDownloads: npmTotalDownloads + nativeDownloads + installerDownloads,
    npmTotalDownloads,
    nativeDownloads,
    installerDownloads,
    monthlyDownloads,
    weeklyDownloads,
  }
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
