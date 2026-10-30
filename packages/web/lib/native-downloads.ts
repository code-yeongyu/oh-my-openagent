import { GITHUB_REPOSITORY, githubHeaders } from "./github"

// The compiled OmO binaries every release attaches: `omo-<os>-<arch>[-variant][.exe]`. SHA256SUMS
// and the desktop engines are release plumbing, not installs, so they are not counted.
const NATIVE_ASSET = /^omo-(?:darwin|linux|windows)-/
// Release pages carry the full release notes (~30 KB each); 30 per page keeps one page under the
// 2 MB fetch-cache item limit.
const PAGE_SIZE = 30
const MAX_PAGES = 50
// The total moves slowly and one refresh walks every release page, so it is refreshed far less
// often than the npm figures; a failed refresh serves the last good total for up to a day.
const FRESH_MS = 6 * 60 * 60 * 1000
const MAX_STALE_MS = 24 * 60 * 60 * 1000

let cache: { readonly total: number; readonly timestamp: number } | null = null

export function resetNativeDownloadsCacheForTests(): void {
  cache = null
}

function readAssetDownloads(asset: unknown): number | null {
  const name = typeof asset === "object" && asset !== null ? Reflect.get(asset, "name") : undefined
  const count =
    typeof asset === "object" && asset !== null ? Reflect.get(asset, "download_count") : undefined
  if (
    typeof name !== "string" ||
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 0
  ) {
    throw new Error("GitHub release asset has no name or download_count")
  }
  return NATIVE_ASSET.test(name) ? count : null
}

function readPage(payload: unknown): {
  readonly releases: number
  readonly binaries: number
  readonly downloads: number
} {
  if (!Array.isArray(payload)) throw new Error("GitHub releases payload is not an array")
  let binaries = 0
  let downloads = 0
  for (const release of payload) {
    const assets =
      typeof release === "object" && release !== null ? Reflect.get(release, "assets") : undefined
    if (!Array.isArray(assets)) throw new Error("GitHub release has no assets array")
    for (const asset of assets) {
      const count = readAssetDownloads(asset)
      if (count === null) continue
      binaries += 1
      downloads += count
    }
  }
  return { releases: payload.length, binaries, downloads }
}

// None of these downloads is an npm install, so the sum adds to the npm lineage without double
// counting. All-or-nothing: a failed or malformed page rejects instead of a partial sum.
export async function fetchNativeDownloads(init: RequestInit): Promise<number> {
  const now = Date.now()
  if (cache && now - cache.timestamp < FRESH_MS) return cache.total
  try {
    const total = await walkReleasePages(init)
    cache = { total, timestamp: now }
    return total
  } catch (error) {
    if (cache && now - cache.timestamp <= MAX_STALE_MS) return cache.total
    throw error
  }
}

async function walkReleasePages(init: RequestInit): Promise<number> {
  let total = 0
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=${PAGE_SIZE}&page=${page}`
    const response = await fetch(url, { ...init, headers: githubHeaders() })
    if (!response.ok) throw new Error(`Upstream ${response.status} for ${url}`)
    const { releases, binaries, downloads } = readPage(await response.json())
    total += downloads
    // Pages run newest first and every release since binaries shipped carries them, so a page
    // without one means the rest of the history predates the compiled binaries.
    if (releases < PAGE_SIZE || binaries === 0) return total
  }
  throw new Error(`GitHub releases exceeded ${MAX_PAGES} pages`)
}
