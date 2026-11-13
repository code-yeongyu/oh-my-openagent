import {
  fetchInstallerDownloads,
  resetInstallerDownloadsCacheForTests,
} from "../installer-downloads"
import { fetchNativeDownloads, resetNativeDownloadsCacheForTests } from "../native-downloads"
import { fetchAllTimeDownloads } from "../npm-downloads"
import { createOgCountSource } from "./live-count"

const downloads = createOgCountSource({
  key: "downloads",
  label: "downloads",
  freshMs: 3_600_000,
  maxStaleMs: 86_400_000,
  load: async () => {
    const init = { cache: "no-store", signal: AbortSignal.timeout(5_000) } satisfies RequestInit
    const [npm, native, installer] = await Promise.all([
      fetchAllTimeDownloads(new Date(Date.now()), init),
      fetchNativeDownloads(init),
      fetchInstallerDownloads(init),
    ])
    return npm + native + installer
  },
})

export const getOgDownloads = downloads.get
export function resetOgDownloadsCacheForTests(): void {
  downloads.reset()
  resetNativeDownloadsCacheForTests()
  resetInstallerDownloadsCacheForTests()
}

/** Floors to the shown precision so the `+` is always true; `null` withholds the figure. */
export function formatOgDownloads(count: number | null): string | null {
  if (count === null) return null
  if (count >= 1_000_000) {
    const millions = (Math.floor(count / 100_000) / 10).toFixed(1).replace(/\.0$/, "")
    return `${millions}M+ Downloads`
  }
  if (count >= 1_000) return `${Math.floor(count / 1_000)}K+ Downloads`
  return `${count} Downloads`
}
