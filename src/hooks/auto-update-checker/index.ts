import type { PluginInput } from "@opencode-ai/plugin"
import { getCachedVersion, getLocalDevVersion, findPluginEntry, getLatestVersion, updatePinnedVersion } from "./checker"
import { invalidatePackage } from "./cache"
import { PACKAGE_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getConfigLoadErrors, clearConfigLoadErrors } from "../../shared/config-errors"
import type { AutoUpdateCheckerOptions } from "./types"

const SISYPHUS_SPINNER = ["·", "•", "●", "○", "◌", "◦", " "]

export function createAutoUpdateCheckerHook(ctx: PluginInput, options: AutoUpdateCheckerOptions = {}) {
  const { showStartupToast = true, isSisyphusEnabled = false, autoUpdate = true } = options

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

  let hasChecked = false

  return {
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created") return
      if (hasChecked) return

      const props = event.properties as { info?: { parentID?: string } } | undefined
      if (props?.info?.parentID) return

      hasChecked = true

      setTimeout(() => {
        const cachedVersion = getCachedVersion()
        const localDevVersion = getLocalDevVersion(ctx.directory)
        const displayVersion = localDevVersion ?? cachedVersion

        showConfigErrorsIfAny(ctx).catch(() => {})

        if (localDevVersion) {
          if (showStartupToast) {
            showLocalDevToast(ctx, displayVersion, isSisyphusEnabled).catch(() => {})
          }
          log("[auto-update-checker] Local development mode")
          return
        }

        if (showStartupToast) {
          showVersionToast(ctx, displayVersion, getToastMessage(false)).catch(() => {})
        }

        runBackgroundUpdateCheck(ctx, autoUpdate, getToastMessage).catch(err => {
          log("[auto-update-checker] Background update check failed:", err)
        })
      }, 0)
    },
  }
}

async function runBackgroundUpdateCheck(
  ctx: PluginInput, 
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
): Promise<void> {
  const pluginInfo = findPluginEntry(ctx.directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return
  }

  const cachedVersion = getCachedVersion()
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
  if (!currentVersion) {
    log("[auto-update-checker] No version found (cached or pinned)")
    return
  }

  const latestVersion = await getLatestVersion()
  if (!latestVersion) {
    log("[auto-update-checker] Failed to fetch latest version")
    return
  }

  if (currentVersion === latestVersion) {
    log("[auto-update-checker] Already on latest version")
    return
  }

  log(`[auto-update-checker] Update available: ${currentVersion} → ${latestVersion}`)

  if (!autoUpdate) {
    await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    log("[auto-update-checker] Auto-update disabled, notification only")
    return
  }

  if (pluginInfo.isPinned) {
    const updated = updatePinnedVersion(pluginInfo.configPath, pluginInfo.entry, latestVersion)
    if (updated) {
      invalidatePackage(PACKAGE_NAME)
      await showAutoUpdatedToast(ctx, currentVersion, latestVersion)
      log(`[auto-update-checker] Config updated: ${pluginInfo.entry} → ${PACKAGE_NAME}@${latestVersion}`)
    } else {
      await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    }
  } else {
    invalidatePackage(PACKAGE_NAME)
    await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
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

async function showVersionToast(ctx: PluginInput, version: string | null, message: string): Promise<void> {
  const displayVersion = version ?? "unknown"
  await showSpinnerToast(ctx, displayVersion, message)
  log(`[auto-update-checker] Startup toast shown: v${displayVersion}`)
}

async function showSpinnerToast(ctx: PluginInput, version: string, message: string): Promise<void> {
  const totalDuration = 5000
  const frameInterval = 100
  const totalFrames = Math.floor(totalDuration / frameInterval)

  for (let i = 0; i < totalFrames; i++) {
    const spinner = SISYPHUS_SPINNER[i % SISYPHUS_SPINNER.length]
    await ctx.client.tui
      .showToast({
        body: {
          title: `${spinner} OhMyOpenCode ${version}`,
          message,
          variant: "info" as const,
          duration: frameInterval + 50,
        },
      })
      .catch(() => { })
    await new Promise(resolve => setTimeout(resolve, frameInterval))
  }
}

async function showUpdateAvailableToast(
  ctx: PluginInput, 
  latestVersion: string,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
): Promise<void> {
  await ctx.client.tui
    .showToast({
      body: {
        title: `OhMyOpenCode ${latestVersion}`,
        message: getToastMessage(true, latestVersion),
        variant: "info" as const,
        duration: 8000,
      },
    })
    .catch(() => {})
  log(`[auto-update-checker] Update available toast shown: v${latestVersion}`)
}

async function showAutoUpdatedToast(ctx: PluginInput, oldVersion: string, newVersion: string): Promise<void> {
  await ctx.client.tui
    .showToast({
      body: {
        title: `OhMyOpenCode Updated!`,
        message: `v${oldVersion} → v${newVersion}\nRestart OpenCode to apply.`,
        variant: "success" as const,
        duration: 8000,
      },
    })
    .catch(() => {})
  log(`[auto-update-checker] Auto-updated toast shown: v${oldVersion} → v${newVersion}`)
}

async function showLocalDevToast(ctx: PluginInput, version: string | null, isSisyphusEnabled: boolean): Promise<void> {
  const displayVersion = version ?? "dev"
  const message = isSisyphusEnabled
    ? "Sisyphus running in local development mode."
    : "Running in local development mode. oMoMoMo..."
  await showSpinnerToast(ctx, `${displayVersion} (dev)`, message)
  log(`[auto-update-checker] Local dev toast shown: v${displayVersion}`)
}

export type { UpdateCheckResult, AutoUpdateCheckerOptions } from "./types"
export { checkForUpdate } from "./checker"
export { invalidatePackage, invalidateCache } from "./cache"
