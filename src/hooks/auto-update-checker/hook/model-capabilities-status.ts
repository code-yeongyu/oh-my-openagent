import type { ModelCapabilitiesConfig } from "../../../config/schema/model-capabilities"
import { refreshModelCapabilitiesCache } from "../../../shared/model-capabilities-cache"
import { log } from "../../../shared/logger"

const DEFAULT_REFRESH_TIMEOUT_MS = 5000

export async function refreshModelCapabilitiesOnStartup(
  config: ModelCapabilitiesConfig | undefined,
): Promise<void> {
  if (config?.enabled === false) {
    return
  }

  if (config?.auto_refresh_on_start === false) {
    return
  }

  const timeoutMs = config?.refresh_timeout_ms ?? DEFAULT_REFRESH_TIMEOUT_MS

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      refreshModelCapabilitiesCache({
        sourceUrl: config?.source_url,
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Model capabilities refresh timed out")), timeoutMs)
      }),
    ])
  } catch (error) {
    log("[auto-update-checker] Model capabilities refresh failed", { error: String(error) })
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
