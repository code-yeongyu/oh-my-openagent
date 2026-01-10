import type { PluginInput } from "@opencode-ai/plugin"
import { findPluginEntry, updatePinnedVersion } from "./checker"
import { invalidatePackage } from "./cache"
import { PACKAGE_NAME, CACHE_DIR } from "./constants"
import { log } from "../../shared/logger"
import { getConfigLoadErrors, clearConfigLoadErrors } from "../../shared/config-errors"
import { runBunInstall } from "../../cli/config-manager"
import type { AutoUpdateCheckerOptions } from "./types"
import {
  checkVersion,
  detectChannel,
  isPrerelease,
  getChannelLabel,
  type VersionCheckResult,
} from "../../shared/version"

const SISYPHUS_SPINNER = ["·", "•", "●", "○", "◌", "◦", " "]

export function isPrereleaseVersion(version: string): boolean {
  return isPrerelease(version)
}

export function isDistTag(version: string): boolean {
  const startsWithDigit = /^\d/.test(version)
  return !startsWithDigit
}

export function isPrereleaseOrDistTag(pinnedVersion: string | null): boolean {
  if (!pinnedVersion) return false
  return isPrereleaseVersion(pinnedVersion) || isDistTag(pinnedVersion)
}

export function createAutoUpdateCheckerHook(ctx: PluginInput, options: AutoUpdateCheckerOptions = {}) {
  const { showStartupToast = true, isSisyphusEnabled = false, autoUpdate = true } = options

  const getToastMessage = (isUpdate: boolean, latestVersion?: string, channel?: string): string => {
    const channelNote = channel && channel !== "stable" ? ` (${channel})` : ""
    if (isSisyphusEnabled) {
      return isUpdate
        ? `Sisyphus on steroids is steering OpenCode.\nv${latestVersion}${channelNote} available. Restart to apply.`
        : `Sisyphus on steroids is steering OpenCode.`
    }
    return isUpdate
      ? `OpenCode is now on Steroids. oMoMoMoMo...\nv${latestVersion}${channelNote} available. Restart OpenCode to apply.`
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

      setTimeout(async () => {
        await showConfigErrorsIfAny(ctx)

        // Use new version checking system
        const versionResult = await checkVersion({ cacheDir: CACHE_DIR })
        const displayVersion = versionResult.currentVersion

        // Check for local dev mode
        const pluginInfo = findPluginEntry(ctx.directory)
        const isLocalDev = pluginInfo?.entry.startsWith("file://") ?? false

        if (isLocalDev) {
          if (showStartupToast) {
            showLocalDevToast(ctx, displayVersion, isSisyphusEnabled).catch(() => {})
          }
          log("[auto-update-checker] Local development mode")
          return
        }

        if (showStartupToast) {
          showVersionToast(ctx, displayVersion, getToastMessage(false)).catch(() => {})
        }

        runBackgroundUpdateCheckV2(ctx, autoUpdate, versionResult, getToastMessage).catch(err => {
          log("[auto-update-checker] Background update check failed:", err)
        })
      }, 0)
    },
  }
}

/**
 * New version-aware update check using the shared version module
 * 
 * The version module already determines the best version to offer:
 * - Stable users: only stable updates
 * - Beta users: whichever is newer (beta or stable)
 */
async function runBackgroundUpdateCheckV2(
  ctx: PluginInput,
  autoUpdate: boolean,
  versionResult: VersionCheckResult,
  getToastMessage: (isUpdate: boolean, latestVersion?: string, channel?: string) => string
): Promise<void> {
  const pluginInfo = findPluginEntry(ctx.directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return
  }

  const { currentVersion, currentChannel, latestForChannel, needsUpdate, updateType } = versionResult

  if (!needsUpdate || !latestForChannel) {
    log(`[auto-update-checker] No update needed (${currentVersion} ${currentChannel})`)
    return
  }

  const targetChannel = detectChannel(latestForChannel)
  log(`[auto-update-checker] Update available: ${currentVersion} (${currentChannel}) → ${latestForChannel} (${targetChannel})`)

  // Show notification for all updates
  if (!autoUpdate) {
    await showUpdateAvailableToast(ctx, latestForChannel, (isUpdate, version) => 
      getToastMessage(isUpdate, version, targetChannel !== "stable" ? getChannelLabel(targetChannel) : undefined)
    )
    log("[auto-update-checker] Auto-update disabled, notification only")
    return
  }

  // Handle pinned versions - only auto-update if pinned to a dist-tag (like "beta")
  // Don't auto-update if pinned to a specific version like "3.0.0-beta.2"
  if (pluginInfo.isPinned) {
    // If pinned to a dist-tag (e.g., "beta", "latest"), we can update
    // If pinned to a specific version, skip auto-update
    if (!isDistTag(pluginInfo.pinnedVersion ?? "")) {
      log(`[auto-update-checker] Skipping auto-update for pinned version: ${pluginInfo.pinnedVersion}`)
      await showUpdateAvailableToast(ctx, latestForChannel, (isUpdate, version) => 
        getToastMessage(isUpdate, version, targetChannel !== "stable" ? getChannelLabel(targetChannel) : undefined)
      )
      return
    }

    const updated = updatePinnedVersion(pluginInfo.configPath, pluginInfo.entry, latestForChannel)
    if (!updated) {
      await showUpdateAvailableToast(ctx, latestForChannel, (isUpdate, version) => 
        getToastMessage(isUpdate, version, targetChannel !== "stable" ? getChannelLabel(targetChannel) : undefined)
      )
      log("[auto-update-checker] Failed to update pinned version in config")
      return
    }
    log(`[auto-update-checker] Config updated: ${pluginInfo.entry} → ${PACKAGE_NAME}@${latestForChannel}`)
  }

  invalidatePackage(PACKAGE_NAME)

  const installSuccess = await runBunInstallSafe()

  if (installSuccess) {
    await showAutoUpdatedToast(ctx, currentVersion, latestForChannel)
    log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestForChannel} (${updateType})`)
  } else {
    await showUpdateAvailableToast(ctx, latestForChannel, (isUpdate, version) => 
      getToastMessage(isUpdate, version, targetChannel !== "stable" ? getChannelLabel(targetChannel) : undefined)
    )
    log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
  }
}

async function runBunInstallSafe(): Promise<boolean> {
  try {
    return await runBunInstall()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[auto-update-checker] bun install error:", errorMessage)
    return false
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
