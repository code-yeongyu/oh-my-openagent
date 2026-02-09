import type { PluginInput } from "@opencode-ai/plugin"
import { isModelCacheAvailable } from "../../../shared/model-availability"
import { log } from "../../../shared/logger"

export async function showModelCacheWarningIfNeeded(ctx: PluginInput): Promise<void> {
  if (isModelCacheAvailable()) return

  await ctx.client.tui
    .showToast({
      body: {
        title: "Model Cache Not Found",
        message:
          "Run 'opencode models --refresh' or restart OpenCode to populate the models cache for optimal agent model selection.",
        variant: "warning" as const,
        duration: 10000,
      },
    })
    .catch(() => {})

  log("[auto-update-checker] Model cache warning shown")
}
