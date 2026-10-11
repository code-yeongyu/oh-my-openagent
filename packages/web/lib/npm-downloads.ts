// OmO shipped under three npm names in sequence, plus the Codex Light edition. None of these
// depends on another, and per-platform binaries are optionalDependencies that are not counted,
// so summing the list counts each install exactly once.
export const NPM_PACKAGES = ["oh-my-opencode", "oh-my-openagent", "omo-ai", "lazycodex-ai"] as const
const NPM_FIRST_PUBLISH_YEAR = 2025

function readDownloads(payload: unknown, pkg: string, range: string): number {
  const entry =
    typeof payload === "object" && payload !== null ? Reflect.get(payload, pkg) : undefined
  const downloads =
    typeof entry === "object" && entry !== null ? Reflect.get(entry, "downloads") : undefined
  if (typeof downloads !== "number" || !Number.isSafeInteger(downloads) || downloads < 0) {
    throw new Error(`npm payload for ${pkg}@${range} has no downloads count`)
  }
  return downloads
}

// One bulk request per range covers every unscoped package, so a refresh stays within npm's
// rate limits. All-or-nothing: a missing or null package rejects instead of contributing 0.
export async function sumLineageDownloads(range: string, init: RequestInit): Promise<number> {
  const url = `https://api.npmjs.org/downloads/point/${range}/${NPM_PACKAGES.join(",")}`
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`Upstream ${response.status} for ${url}`)
  }
  const payload: unknown = await response.json()
  return NPM_PACKAGES.reduce((sum, pkg) => sum + readDownloads(payload, pkg, range), 0)
}

// Bulk point ranges are capped at 365 days, so all-time is summed one calendar year at a time.
function yearRanges(now: Date): readonly string[] {
  const today = now.toISOString().slice(0, 10)
  const currentYear = now.getUTCFullYear()
  const ranges: string[] = []
  for (let year = NPM_FIRST_PUBLISH_YEAR; year <= currentYear; year++) {
    const end = year === currentYear ? today : `${year}-12-31`
    ranges.push(`${year}-01-01:${end}`)
  }
  return ranges
}

export async function fetchAllTimeDownloads(now: Date, init: RequestInit): Promise<number> {
  const perYear = await Promise.all(
    yearRanges(now).map((range) => sumLineageDownloads(range, init)),
  )
  return perYear.reduce((sum, n) => sum + n, 0)
}
