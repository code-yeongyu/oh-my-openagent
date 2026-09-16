const FRESH_MS = 300_000
const MAX_STALE_MS = 86_400_000

export type OgStars =
  | { readonly count: number; readonly source: "live"; readonly expiresAt: number }
  | { readonly count: number; readonly source: "stale" }
  | { readonly count: null; readonly source: "unavailable" }

let cache: { readonly count: number; readonly timestamp: number } | null = null
let pending: Promise<OgStars> | null = null

export function resetOgStarsCacheForTests(): void {
  cache = null
  pending = null
}

export function formatOgStars(count: number | null): string {
  if (count === null) return "GitHub"
  return count >= 1_000 ? `${Math.floor(count / 1_000)}K+ Stars` : `${count} Stars`
}

async function refreshStars(): Promise<OgStars> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "omo-web-og",
    }
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }
    const response = await fetch("https://api.github.com/repos/code-yeongyu/oh-my-openagent", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`GitHub stars: HTTP ${response.status}`)
    const payload: unknown = await response.json()
    const count =
      typeof payload === "object" && payload !== null
        ? Reflect.get(payload, "stargazers_count")
        : undefined
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("GitHub stars: invalid stargazers_count")
    }
    cache = { count, timestamp: Date.now() }
    return { count, source: "live", expiresAt: cache.timestamp + FRESH_MS }
  } catch (error) {
    console.warn("Unable to refresh OG GitHub stars", error)
    if (cache && Date.now() - cache.timestamp <= MAX_STALE_MS) {
      return { count: cache.count, source: "stale" }
    }
    return { count: null, source: "unavailable" }
  }
}

export async function getOgStars(): Promise<OgStars> {
  if (cache && Date.now() - cache.timestamp < FRESH_MS) {
    return { count: cache.count, source: "live", expiresAt: cache.timestamp + FRESH_MS }
  }
  if (pending) return pending
  pending = refreshStars()
  try {
    return await pending
  } finally {
    pending = null
  }
}
