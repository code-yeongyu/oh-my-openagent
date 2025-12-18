import type { PluginInput } from "@opencode-ai/plugin"
import { checkForUpdate, getCachedVersion, getLocalDevVersion } from "./checker"
import { invalidatePackage } from "./cache"
import { PACKAGE_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getUserConfigPath } from "../../shared/config-path"
import { getConfigLoadErrors, clearConfigLoadErrors } from "../../shared/config-errors"
import type { AutoUpdateCheckerOptions } from "./types"

export function createAutoUpdateCheckerHook(ctx: PluginInput, options: AutoUpdateCheckerOptions = {}) {
  const { showStartupToast = true } = options
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
          if (showStartupToast) {
            const version = getLocalDevVersion(ctx.directory) ?? getCachedVersion()
            await showVersionToast(ctx, version)
          }
          return
        }

        if (result.isPinned) {
          log(`[auto-update-checker] Skipped: version pinned to ${result.currentVersion}`)
          if (showStartupToast) {
            await showVersionToast(ctx, result.currentVersion)
          }
          return
        }

        if (!result.needsUpdate) {
          log("[auto-update-checker] No update needed")
          if (showStartupToast) {
            await showVersionToast(ctx, result.currentVersion)
          }
          return
        }

        invalidatePackage(PACKAGE_NAME)

        await ctx.client.tui
          .showToast({
            body: {
              title: `OhMyOpenCode ${result.latestVersion}`,
              message: `OpenCode is now on Steroids. oMoMoMoMo...\nv${result.latestVersion} available. Restart OpenCode to apply.`,
              variant: "info" as const,
              duration: 8000,
            },
          })
          .catch(() => {})

        log(`[auto-update-checker] Update notification sent: v${result.currentVersion} → v${result.latestVersion}`)
      } catch (err) {
        log("[auto-update-checker] Error during update check:", err)
      }

      await showConfigErrorsIfAny(ctx)
    },
  }
}

async function showConfigErrorsIfAny(ctx: PluginInput): Promise<void> {
  const errors = getConfigLoadErrors()
  if (errors.length === 0) return

  const errorMessages = errors.map(e => `${e.path}: ${e.error}`).join("\n")
  await ctx.client.tui
    .showToast({
      body: {
        title: "Config Load Error",
        message: `Failed to load config:\n${errorMessages}`,
        variant: "error" as const,
        duration: 10000,
      },
    })
    .catch(() => {})

  log(`[auto-update-checker] Config load errors shown: ${errors.length} error(s)`)
  clearConfigLoadErrors()
}

async function showVersionToast(ctx: PluginInput, version: string | null): Promise<void> {
  const displayVersion = version ?? "unknown"
  const configPath = getUserConfigPath()
  await ctx.client.tui
    .showToast({
      body: {
        title: `OhMyOpenCode ${displayVersion}`,
        message: `OpenCode is now on Steroids. oMoMoMoMo...\nConfig: ${configPath}`,
        variant: "info" as const,
        duration: 5000,
      },
    })
    .catch(() => {})
  log(`[auto-update-checker] Startup toast shown: v${displayVersion}`)
}

export type { UpdateCheckResult, AutoUpdateCheckerOptions } from "./types"
export { checkForUpdate } from "./checker"
export { invalidatePackage, invalidateCache } from "./cache"
