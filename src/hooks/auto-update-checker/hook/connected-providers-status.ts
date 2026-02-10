import type { PluginInput } from "@opencode-ai/plugin"
import {
  hasConnectedProvidersCache,
  updateConnectedProvidersCache,
} from "../../../shared/connected-providers-cache"
import { log } from "../../../shared/logger"

export async function updateAndShowConnectedProvidersCacheStatus(ctx: PluginInput): Promise<void> {
  const hadCache = hasConnectedProvidersCache()

  updateConnectedProvidersCache(ctx.client).catch(() => {})

  if (!hadCache) {
    await ctx.client.tui
      .showToast({
        body: {
          title: "Connected Providers Cache",
          message: "Building provider cache for first time. Restart OpenCode for full model filtering.",
          variant: "info" as const,
          duration: 8000,
        },
      })
      .catch(() => {})

    log("[auto-update-checker] Connected providers cache toast shown (first run)")
  } else {
    log("[auto-update-checker] Connected providers cache exists, updating in background")
  }
}
