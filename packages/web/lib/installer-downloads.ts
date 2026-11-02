// get.omo.dev serves compiled binaries from its R2 mirror; those downloads never reach GitHub's
// download_count. Its /stats/downloads rollup reports exactly that uncounted part (mirror-served
// binaries plus signed corrections such as removed QA installs); installs it redirected to GitHub
// are already inside the GitHub release total, so they are not added again.
export const INSTALLER_STATS_URL = "https://get.omo.dev/stats/downloads"
const FRESH_MS = 60 * 60 * 1000
const MAX_STALE_MS = 24 * 60 * 60 * 1000

let cache: { readonly total: number; readonly timestamp: number } | null = null

export function resetInstallerDownloadsCacheForTests(): void {
  cache = null
}

function readUncounted(payload: unknown): number {
  const value =
    typeof payload === "object" && payload !== null
      ? Reflect.get(payload, "uncountedByGitHub")
      : undefined
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("get.omo.dev download stats have no uncountedByGitHub count")
  }
  return value
}

export async function fetchInstallerDownloads(init: RequestInit): Promise<number> {
  const now = Date.now()
  if (cache && now - cache.timestamp < FRESH_MS) return cache.total
  try {
    const response = await fetch(INSTALLER_STATS_URL, {
      ...init,
      headers: { Accept: "application/json" },
    })
    if (!response.ok) throw new Error(`Upstream ${response.status} for ${INSTALLER_STATS_URL}`)
    const total = readUncounted(await response.json())
    cache = { total, timestamp: now }
    return total
  } catch (error) {
    if (cache && now - cache.timestamp <= MAX_STALE_MS) return cache.total
    throw error
  }
}
