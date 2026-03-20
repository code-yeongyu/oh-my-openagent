import type { PluginInput } from "@opencode-ai/plugin"
import { updateConnectedProvidersCache } from "../../../shared/connected-providers-cache"
import { isModelCacheAvailable } from "../../../shared/model-availability"
import { log } from "../../../shared/logger"

const CACHE_UPDATE_TIMEOUT_MS = 10000

export async function updateAndShowConnectedProvidersCacheStatus(ctx: PluginInput): Promise<void> {
  const hadCache = isModelCacheAvailable()

  if (!hadCache) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        updateConnectedProvidersCache(ctx.client),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Cache update timed out")), CACHE_UPDATE_TIMEOUT_MS)
        }),
      ])
    } catch (err) {
      log("[auto-update-checker] Connected providers cache creation failed", { error: String(err) })
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }

    if (!isModelCacheAvailable()) {
      await ctx.client.tui
        .showToast({
          body: {
            title: "Connected Providers Cache",
            message: "Failed to build provider cache. Restart OpenCode to retry.",
            variant: "warning" as const,
            duration: 8000,
          },
        })
        .catch(() => {})

      log("[auto-update-checker] Connected providers cache toast shown (creation failed)")
    } else {
      log("[auto-update-checker] Connected providers cache created on first run")
    }
  } else {
    updateConnectedProvidersCache(ctx.client).catch((err) => {
      log("[auto-update-checker] Background cache update failed", { error: String(err) })
    })
    log("[auto-update-checker] Connected providers cache exists, updating in background")
  }
}
