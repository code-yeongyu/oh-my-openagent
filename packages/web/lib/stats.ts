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

/**
 * A last-known-good copy shared by every isolate in the data center (the Workers Cache API), so a cold isolate
 * whose first refresh hits an upstream blip serves the last full aggregate instead of FALLBACK_STATS_DATA. Only a
 * complete aggregate is ever written (the refresh is all-or-nothing); a store miss or a malformed entry still
 * rethrows, and callers render the fallback only then (no good value ever stored here).
 */
export interface StatsStore {
  read(): Promise<StatsCache | null>
  write(entry: StatsCache): Promise<void>
}

/** A Cache API key is a URL; this one is never fetched from the network. */
const LAST_KNOWN_GOOD_KEY = "https://omo.dev/__stats/last-known-good/v1"
const LAST_KNOWN_GOOD_TTL_S = 7 * 24 * 60 * 60

function isStatsData(value: unknown): value is StatsData {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  const counts = [
    "stars",
    "totalDownloads",
    "npmTotalDownloads",
    "nativeDownloads",
    "installerDownloads",
    "monthlyDownloads",
    "weeklyDownloads",
  ]
  return (
    typeof v.description === "string" &&
    counts.every((k) => typeof v[k] === "number" && Number.isFinite(v[k]) && (v[k] as number) >= 0)
  )
}

function cacheApiStore(): StatsStore | null {
  const shared = (globalThis as { caches?: { default?: Cache } }).caches?.default
  if (!shared) return null
  return {
    async read() {
      const hit = await shared.match(LAST_KNOWN_GOOD_KEY)
      if (!hit) return null
      const entry = (await hit.json().catch(() => null)) as {
        data?: unknown
        timestamp?: unknown
      } | null
      return entry && isStatsData(entry.data) && typeof entry.timestamp === "number"
        ? { data: entry.data, timestamp: entry.timestamp }
        : null
    },
    async write(entry) {
      await shared.put(
        LAST_KNOWN_GOOD_KEY,
        new Response(JSON.stringify(entry), {
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${LAST_KNOWN_GOOD_TTL_S}`,
          },
        }),
      )
    },
  }
}

let storeOverride: StatsStore | null | undefined
const sharedStore = (): StatsStore | null =>
  storeOverride === undefined ? cacheApiStore() : storeOverride

export function setStatsStoreForTests(store: StatsStore | null | undefined): void {
  storeOverride = store
}

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
    await sharedStore()
      ?.write(cache)
      .catch((error: unknown) =>
        console.warn("Stats: could not store the last known-good copy", error),
      )
    return data
  } catch (error) {
    if (cache) {
      console.warn("Stats refresh failed; serving last known-good values", error)
      return cache.data
    }
    const stored = await sharedStore()
      ?.read()
      .catch(() => null)
    if (stored) {
      console.warn(
        "Stats refresh failed in a cold isolate; serving the shared last known-good values",
        error,
      )
      // Kept with its original time, so the next request in this isolate tries a fresh refresh again.
      cache = stored
      return stored.data
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
