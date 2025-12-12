import type { PluginInput } from "@opencode-ai/plugin"
import { checkForUpdate } from "./checker"
import { invalidateCache } from "./cache"
import { PACKAGE_NAME } from "./constants"
import { log } from "../../shared/logger"

export function createAutoUpdateCheckerHook(ctx: PluginInput) {
  let hasChecked = false

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created") return
      if (hasChecked) return

      const props = event.properties as { info?: { parentID?: string } } | undefined
      if (props?.info?.parentID) return

      hasChecked = true

      try {
        const result = await checkForUpdate(ctx.directory)

        if (result.isLocalDev) {
          log("[auto-update-checker] Skipped: local development mode")
          return
        }

        if (!result.needsUpdate) {
          log("[auto-update-checker] No update needed")
          return
        }

        invalidateCache()

        await ctx.client.tui
          .showToast({
            body: {
              title: `${PACKAGE_NAME} Update`,
              message: `v${result.latestVersion} available (current: v${result.currentVersion}). Restart OpenCode to apply.`,
              variant: "info" as const,
              duration: 8000,
            },
          })
          .catch(() => {})

        log(`[auto-update-checker] Update notification sent: v${result.currentVersion} → v${result.latestVersion}`)
      } catch (err) {
        log("[auto-update-checker] Error during update check:", err)
      }
    },
  }
}

export type { UpdateCheckResult } from "./types"
export { checkForUpdate } from "./checker"
export { invalidateCache } from "./cache"
