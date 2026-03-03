import { NPM_FETCH_TIMEOUT, NPM_REGISTRY_URL } from "../constants"
import type { NpmDistTags } from "../types"

export async function getLatestVersion(channel: string = "latest"): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), NPM_FETCH_TIMEOUT)

  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })

    if (!response.ok) return null

    const data = (await response.json()) as NpmDistTags
    return data[channel] ?? data.latest ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
