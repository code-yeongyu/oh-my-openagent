import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { runBunInstallWithDetails } from "../../../cli/config-manager"
import { getManagedPluginStatePath, readManagedPluginState, writeManagedPluginState } from "../../../shared/managed-plugin-state"
import { log } from "../../../shared/logger"
import { getOpenCodeCacheDir, getOpenCodeConfigPaths } from "../../../shared"
import { invalidatePackage } from "../cache"
import { PACKAGE_NAME } from "../constants"
import { extractChannel } from "../version-channel"
import { findPluginEntry, getCachedVersion, getLatestVersion, syncCachePackageJsonToIntent } from "../checker"
import { revertPinnedVersion, updatePinnedVersion } from "../checker/pinned-version-updater"
import { showAutoUpdatedToast, showUpdateAvailableToast } from "./update-toasts"

type BackgroundUpdateCheckDeps = {
  existsSync: typeof existsSync
  join: typeof join
  runBunInstallWithDetails: typeof runBunInstallWithDetails
  log: typeof log
  getOpenCodeCacheDir: typeof getOpenCodeCacheDir
  getOpenCodeConfigPaths: typeof getOpenCodeConfigPaths
  invalidatePackage: typeof invalidatePackage
  extractChannel: typeof extractChannel
  findPluginEntry: typeof findPluginEntry
  getCachedVersion: typeof getCachedVersion
  getLatestVersion: typeof getLatestVersion
  readManagedPluginState: typeof readManagedPluginState
  writeManagedPluginState: typeof writeManagedPluginState
  syncCachePackageJsonToIntent: typeof syncCachePackageJsonToIntent
  updatePinnedVersion: typeof updatePinnedVersion
  revertPinnedVersion: typeof revertPinnedVersion
  showUpdateAvailableToast: typeof showUpdateAvailableToast
  showAutoUpdatedToast: typeof showAutoUpdatedToast
}

type BackgroundUpdateCheckRunner = (
  ctx: PluginInput,
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
) => Promise<void>

function getCacheWorkspaceDir(deps: BackgroundUpdateCheckDeps): string {
  return deps.join(deps.getOpenCodeCacheDir(), "packages")
}

const defaultDeps: BackgroundUpdateCheckDeps = {
  existsSync,
  join,
  runBunInstallWithDetails,
  log,
  getOpenCodeCacheDir,
  getOpenCodeConfigPaths,
  invalidatePackage,
  extractChannel,
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  readManagedPluginState,
  writeManagedPluginState,
  syncCachePackageJsonToIntent,
  updatePinnedVersion,
  revertPinnedVersion,
  showUpdateAvailableToast,
  showAutoUpdatedToast,
}

function getPinnedVersionToastMessage(latestVersion: string): string {
  return `Update available: ${latestVersion} (version pinned, update manually)`
}

function buildVersionedEntry(entry: string, version: string): string {
  const atIndex = entry.lastIndexOf("@")
  const packageName = atIndex === -1 ? entry : entry.slice(0, atIndex)
  return `${packageName}@${version}`
}

/**
 * Resolves the active install workspace.
 * Same logic as doctor check: prefer config-dir if installed, fall back to cache-dir.
 */
function resolveActiveInstallWorkspace(deps: BackgroundUpdateCheckDeps): string {
  const configPaths = deps.getOpenCodeConfigPaths({ binary: "opencode" })
  const cacheDir = getCacheWorkspaceDir(deps)

  const configInstallPath = deps.join(configPaths.configDir, "node_modules", PACKAGE_NAME, "package.json")
  const cacheInstallPath = deps.join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")

  // Prefer config-dir if installed there, otherwise fall back to cache-dir
  if (deps.existsSync(configInstallPath)) {
    deps.log(`[auto-update-checker] Active workspace: config-dir (${configPaths.configDir})`)
    return configPaths.configDir
  }

  if (deps.existsSync(cacheInstallPath)) {
    deps.log(`[auto-update-checker] Active workspace: cache-dir (${cacheDir})`)
    return cacheDir
  }

  const cachePackageJsonPath = deps.join(cacheDir, "package.json")
  if (deps.existsSync(cachePackageJsonPath)) {
    deps.log(`[auto-update-checker] Active workspace: cache-dir (${cacheDir}, package.json present)`) 
    return cacheDir
  }

  // Default to config-dir if neither exists (matches doctor behavior)
  deps.log(`[auto-update-checker] Active workspace: config-dir (default, no install detected)`)
  return configPaths.configDir
}

async function runBunInstallSafe(workspaceDir: string, deps: BackgroundUpdateCheckDeps): Promise<boolean> {
  try {
    const result = await deps.runBunInstallWithDetails({ outputMode: "pipe", workspaceDir })
    if (!result.success && result.error) {
      deps.log("[auto-update-checker] bun install error:", result.error)
    }
    return result.success
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    deps.log("[auto-update-checker] bun install error:", errorMessage)
    return false
  }
}

async function primeCacheWorkspace(
  activeWorkspace: string,
  deps: BackgroundUpdateCheckDeps,
): Promise<boolean> {
  const cacheWorkspace = getCacheWorkspaceDir(deps)
  if (activeWorkspace === cacheWorkspace) {
    return true
  }

  deps.log(`[auto-update-checker] Priming cache workspace after install: ${cacheWorkspace}`)
  return runBunInstallSafe(cacheWorkspace, deps)
}

export function createBackgroundUpdateCheckRunner(
  overrides: Partial<BackgroundUpdateCheckDeps> = {},
): BackgroundUpdateCheckRunner {
  const deps = { ...defaultDeps, ...overrides }

  return async function runBackgroundUpdateCheck(
    ctx: PluginInput,
    autoUpdate: boolean,
    getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
  ): Promise<void> {
    const pluginInfo = deps.findPluginEntry(ctx.directory)
    if (!pluginInfo) {
      deps.log("[auto-update-checker] Plugin not found in config")
      return
    }

    const configPaths = deps.getOpenCodeConfigPaths({ binary: "opencode" })
    const managedState = deps.readManagedPluginState(configPaths.configDir)
    const cachedVersion = deps.getCachedVersion()
    const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
    if (!currentVersion) {
      deps.log("[auto-update-checker] No version found (cached or pinned)")
      return
    }

    const isManagedPinnedEntry =
      pluginInfo.isPinned &&
      managedState?.entry === pluginInfo.entry &&
      managedState.channel.trim().length > 0

    const channel = isManagedPinnedEntry
      ? managedState.channel
      : deps.extractChannel(pluginInfo.pinnedVersion ?? currentVersion)

    const latestVersion = await deps.getLatestVersion(channel)
    if (!latestVersion) {
      deps.log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
      return
    }

    if (currentVersion === latestVersion) {
      if (!pluginInfo.isPinned) {
        const updatedManagedEntry = buildVersionedEntry(pluginInfo.entry, currentVersion)
        const migrated = deps.updatePinnedVersion(pluginInfo.configPath, pluginInfo.entry, currentVersion)
        if (migrated) {
          const wroteState = deps.writeManagedPluginState(configPaths.configDir, {
            entry: updatedManagedEntry,
            channel,
          })
          if (!wroteState) {
            deps.log(`[auto-update-checker] Failed to persist managed plugin state: ${getManagedPluginStatePath(configPaths.configDir)}`)
          }
        } else {
          deps.log(`[auto-update-checker] Failed to migrate dynamic plugin entry to managed exact version: ${pluginInfo.entry}`)
        }
      }

      deps.log("[auto-update-checker] Already on latest version for channel:", channel)
      return
    }

    deps.log(`[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`)

    if (!autoUpdate) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      deps.log("[auto-update-checker] Auto-update disabled, notification only")
      return
    }

    if (pluginInfo.isPinned && !isManagedPinnedEntry) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, () => getPinnedVersionToastMessage(latestVersion))
      deps.log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
      return
    }

    let intendedPluginInfo = pluginInfo
    let updatedManagedEntry: string | null = null
    const shouldManageEntry = !pluginInfo.isPinned || isManagedPinnedEntry

    const revertManagedPinnedConfig = (): void => {
      if (!updatedManagedEntry) {
        return
      }
      const reverted = deps.revertPinnedVersion(pluginInfo.configPath, latestVersion, pluginInfo.entry)
      if (!reverted) {
        deps.log(`[auto-update-checker] Failed to revert managed pinned config after install failure: ${pluginInfo.configPath}`)
      }
    }

    if (shouldManageEntry) {
      const updated = deps.updatePinnedVersion(pluginInfo.configPath, pluginInfo.entry, latestVersion)
      if (!updated) {
        await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
        deps.log(`[auto-update-checker] Failed to update managed config entry: ${pluginInfo.entry}`)
        return
      }

      updatedManagedEntry = buildVersionedEntry(pluginInfo.entry, latestVersion)
      intendedPluginInfo = {
        ...pluginInfo,
        entry: updatedManagedEntry,
        pinnedVersion: latestVersion,
      }
    }

    const syncResult = deps.syncCachePackageJsonToIntent(intendedPluginInfo)
    if (syncResult.error) {
      revertManagedPinnedConfig()
      deps.log(`[auto-update-checker] Sync failed with error: ${syncResult.error}`, syncResult.message)
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      return
    }

    deps.invalidatePackage(PACKAGE_NAME)
    const activeWorkspace = resolveActiveInstallWorkspace(deps)
    const installSuccess = await runBunInstallSafe(activeWorkspace, deps)

    if (installSuccess) {
      const cachePrimed = await primeCacheWorkspace(activeWorkspace, deps)
      if (!cachePrimed) {
        revertManagedPinnedConfig()
        await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
        deps.log("[auto-update-checker] cache workspace priming failed after install")
        return
      }

      if (updatedManagedEntry) {
        const wroteState = deps.writeManagedPluginState(configPaths.configDir, {
          entry: updatedManagedEntry,
          channel,
        })
        if (!wroteState) {
          deps.log(`[auto-update-checker] Failed to persist managed plugin state: ${getManagedPluginStatePath(configPaths.configDir)}`)
        }
      }

      await deps.showAutoUpdatedToast(ctx, currentVersion, latestVersion)
      deps.log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
      return
    }

    revertManagedPinnedConfig()
    await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    deps.log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
  }
}

export const runBackgroundUpdateCheck = createBackgroundUpdateCheckRunner()
