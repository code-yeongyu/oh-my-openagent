import type { PluginInput } from "@opencode-ai/plugin"
import { checkForUpdate, getCachedVersion, getLocalDevVersion } from "./checker"
import { invalidatePackage } from "./cache"
import { PACKAGE_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getConfigLoadErrors, clearConfigLoadErrors } from "../../shared/config-errors"
import type { AutoUpdateCheckerOptions } from "./types"

export function createAutoUpdateCheckerHook(ctx: PluginInput, options: AutoUpdateCheckerOptions = {}) {
  const { showStartupToast = true, isSisyphusEnabled = false } = options

  const getToastMessage = (isUpdate: boolean, latestVersion?: string): string => {
    if (isSisyphusEnabled) {
      return isUpdate
        ? `Sisyphus on steroids is steering OpenCode.\nv${latestVersion} available. Restart to apply.`
        : `Sisyphus on steroids is steering OpenCode.`
    }
    return isUpdate
      ? `OpenCode is now on Steroids. oMoMoMoMo...\nv${latestVersion} available. Restart OpenCode to apply.`
      : `OpenCode is now on Steroids. oMoMoMoMo...`
  }

  const showVersionToast = async (version: string | null): Promise<void> => {
    const displayVersion = version ?? "unknown"
    await ctx.client.tui
      .showToast({
        body: {
          title: `OhMyOpenCode ${displayVersion}`,
          message: getToastMessage(false),
          variant: "info" as const,
          duration: 5000,
        },
      })
      .catch(() => {})
    log(`[auto-update-checker] Startup toast shown: v${displayVersion}`)
  }

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
            await showVersionToast(version)
          }
          return
        }

        if (result.isPinned) {
          log(`[auto-update-checker] Skipped: version pinned to ${result.currentVersion}`)
          if (showStartupToast) {
            await showVersionToast(result.currentVersion)
          }
          return
        }

        if (!result.needsUpdate) {
          log("[auto-update-checker] No update needed")
          if (showStartupToast) {
            await showVersionToast(result.currentVersion)
          }
          return
        }

        invalidatePackage(PACKAGE_NAME)

        await ctx.client.tui
          .showToast({
            body: {
              title: `OhMyOpenCode ${result.latestVersion}`,
              message: getToastMessage(true, result.latestVersion ?? undefined),
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

export type { UpdateCheckResult, AutoUpdateCheckerOptions } from "./types"
export { checkForUpdate } from "./checker"
export { invalidatePackage, invalidateCache } from "./cache"
