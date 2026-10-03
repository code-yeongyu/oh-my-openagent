import { createOgCountSource, type OgCount } from "./live-count"

export type OgStars = OgCount

async function loadStars(): Promise<number> {
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
  return count
}

const stars = createOgCountSource({
  key: "github-stars",
  label: "GitHub stars",
  freshMs: 300_000,
  maxStaleMs: 86_400_000,
  load: loadStars,
})

export const getOgStars = stars.get
export const resetOgStarsCacheForTests = stars.reset

export function formatOgStars(count: number | null): string {
  if (count === null) return "GitHub"
  return count >= 1_000 ? `${Math.floor(count / 1_000)}K+ Stars` : `${count} Stars`
}
