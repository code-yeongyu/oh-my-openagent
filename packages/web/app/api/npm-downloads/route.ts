import { downloadBadgeResponse, liveDownloadBadge } from "@/lib/download-badge"
import { getStats } from "@/lib/stats"

/**
 * Shields.io endpoint badge for combined NPM downloads.
 * Usage: https://img.shields.io/endpoint?url=https://omo.dev/api/npm-downloads
 *
 * Combines downloads across the package lineage (see lib/stats.ts). The all-channel figure,
 * npm plus the release binaries, is served by /api/downloads.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const period = searchParams.get("period") ?? "total"

  try {
    const stats = await getStats()
    switch (period) {
      case "monthly":
        return liveDownloadBadge("npm downloads/month", stats.monthlyDownloads)
      case "weekly":
        return liveDownloadBadge("npm downloads/week", stats.weeklyDownloads)
      case "total":
      default:
        return liveDownloadBadge("npm downloads", stats.npmTotalDownloads)
    }
  } catch {
    return downloadBadgeResponse("npm downloads", "1M+", false)
  }
}
