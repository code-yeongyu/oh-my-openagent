// Release-asset downloads for the installer mirror, with retry for transient GitHub failures.
// GitHub returns HTTP 5xx (and drops connections) often enough that 3 quick attempts lose a whole
// release to one blip (see #9221: omo 5.1.3 stalled on the previous version until a manual re-run).
// Policy: 5xx and network errors retry with exponential backoff inside a bounded window of about
// 10 minutes per asset; any other non-2xx status (404, 403, ...) fails on the first attempt, because
// retrying cannot fix it. The final failure is an AssetDownloadError naming the asset and the last
// status seen, so the job summary can say exactly what failed.

export const DOWNLOAD_MAX_ELAPSED_MS = 600_000
export const DOWNLOAD_BASE_DELAY_MS = 5_000
export const DOWNLOAD_MAX_DELAY_MS = 60_000

export class AssetDownloadError extends Error {
  constructor(
    readonly assetName: string,
    readonly status: number | null,
    readonly attempts: number,
    detail: string,
  ) {
    super(`download ${assetName}: ${detail} (gave up after ${attempts} attempt${attempts === 1 ? "" : "s"})`)
    this.name = "AssetDownloadError"
  }
}

export interface DownloadRetryInfo {
  readonly assetName: string
  readonly attempt: number
  readonly status: number | null
  readonly delayMs: number
}

export interface DownloadOptions {
  readonly maxElapsedMs?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly fetchFn?: typeof fetch
  readonly now?: () => number
  readonly onRetry?: (info: DownloadRetryInfo) => void
}

export function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599
}

export function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), maxDelayMs)
}

export function formatDownloadFailureSummary(error: AssetDownloadError): string {
  const last = error.status === null ? "network error (no response)" : `HTTP ${error.status}`
  return `- Failed to download asset \`${error.assetName}\`: last status ${last} after ${error.attempts} attempt${error.attempts === 1 ? "" : "s"}.`
}

export async function downloadAssetFile(
  url: string,
  assetName: string,
  path: string,
  options: DownloadOptions = {},
): Promise<{ readonly attempts: number; readonly status: number }> {
  const maxElapsedMs = options.maxElapsedMs ?? DOWNLOAD_MAX_ELAPSED_MS
  const baseDelayMs = options.baseDelayMs ?? DOWNLOAD_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DOWNLOAD_MAX_DELAY_MS
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms))
  const fetchFn = options.fetchFn ?? fetch
  const now = options.now ?? Date.now
  const startedAt = now()
  for (let attempt = 1; ; attempt++) {
    let status: number | null = null
    let detail: string
    try {
      const response = await fetchFn(url)
      status = response.status
      if (response.ok) {
        await Bun.write(path, response)
        return { attempts: attempt, status }
      }
      await response.text().catch(() => "")
      detail = `HTTP ${status}`
      if (!isRetryableStatus(status)) throw new AssetDownloadError(assetName, status, attempt, detail)
    } catch (error) {
      if (error instanceof AssetDownloadError) throw error
      detail = `network error (${String(error).split("\n")[0]})`
    }
    const delayMs = backoffDelayMs(attempt, baseDelayMs, maxDelayMs)
    if (now() - startedAt + delayMs > maxElapsedMs) throw new AssetDownloadError(assetName, status, attempt, detail)
    options.onRetry?.({ assetName, attempt, status, delayMs })
    await sleep(delayMs)
  }
}
