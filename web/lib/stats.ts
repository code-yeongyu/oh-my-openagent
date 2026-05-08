const GITHUB_OWNER = "code-yeongyu"
const GITHUB_REPO = "oh-my-openagent"
const NPM_PACKAGES = ["oh-my-opencode", "oh-my-openagent"]
const NPM_FIRST_PUBLISH_YEAR = 2025

const CACHE_TTL_MS = 60 * 60 * 1000

interface StatsCache {
  data: StatsData
  timestamp: number
}

export interface StatsData {
  stars: number
  totalDownloads: number
  monthlyDownloads: number
  weeklyDownloads: number
}

let cache: StatsCache | null = null

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

async function fetchGitHubStars(): Promise<number> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "oh-my-openagent-web",
  }

  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`, {
    headers,
    next: { revalidate: 3600 },
  })

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`)
  }

  const data = await res.json()
  return data.stargazers_count
}

async function fetchNpmDownloadsForPackage(period: string, pkg: string): Promise<number> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/${period}/${pkg}`, {
      next: { revalidate: 3600 },
    })

    if (!res.ok) return 0

    const data = await res.json()
    return data.downloads ?? 0
  } catch {
    return 0
  }
}

async function fetchNpmDownloads(period: string): Promise<number> {
  const results = await Promise.all(
    NPM_PACKAGES.map((pkg) => fetchNpmDownloadsForPackage(period, pkg)),
  )
  return results.reduce((sum, n) => sum + n, 0)
}

async function fetchAllNpmDownloadsForPackage(pkg: string): Promise<number> {
  const now = new Date()
  let total = 0
  let year = NPM_FIRST_PUBLISH_YEAR

  while (year <= now.getFullYear()) {
    const start = `${year}-01-01`
    const endDate = new Date(year, 11, 31)
    const end = endDate > now ? now.toISOString().split("T")[0]! : `${year}-12-31`

    try {
      const res = await fetch(`https://api.npmjs.org/downloads/point/${start}:${end}/${pkg}`, {
        next: { revalidate: 3600 },
      })
      if (res.ok) {
        const data = await res.json()
        total += data.downloads ?? 0
      }
    } catch {
      continue
    }
    year++
  }

  return total
}

async function fetchAllNpmDownloads(): Promise<number> {
  const results = await Promise.all(NPM_PACKAGES.map((pkg) => fetchAllNpmDownloadsForPackage(pkg)))
  return results.reduce((sum, n) => sum + n, 0)
}

export async function getStats(): Promise<StatsData> {
  const now = Date.now()

  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data
  }

  const [stars, monthlyDownloads, weeklyDownloads, totalDownloads] = await Promise.all([
    fetchGitHubStars(),
    fetchNpmDownloads("last-month"),
    fetchNpmDownloads("last-week"),
    fetchAllNpmDownloads(),
  ])

  const data: StatsData = { stars, totalDownloads, monthlyDownloads, weeklyDownloads }
  cache = { data, timestamp: now }

  return data
}

export function formatStats(stats: StatsData) {
  return {
    stars: formatCount(stats.stars),
    totalDownloads: formatCount(stats.totalDownloads),
    monthlyDownloads: formatCount(stats.monthlyDownloads),
    weeklyDownloads: formatCount(stats.weeklyDownloads),
  }
}
