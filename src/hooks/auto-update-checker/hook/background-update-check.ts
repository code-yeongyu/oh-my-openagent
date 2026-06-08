import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runBunInstallWithDetails } from "../../../cli/config-manager"
import { log } from "../../../shared/logger"
import { getOpenCodeCacheDir, getOpenCodeConfigPaths } from "../../../shared"
import { invalidatePackage } from "../cache"
import { PACKAGE_NAME } from "../constants"
import { extractChannel } from "../version-channel"
import { findPluginEntry, getCachedVersion, getLatestVersion, syncCachePackageJsonToIntent } from "../checker"
import { findPackageJsonUp } from "../checker/package-json-locator"
import { showAutoUpdatedToast, showUpdateAvailableToast } from "./update-toasts"

/**
 * Walk up from this module's location to the host workspace that owns the
 * installed `node_modules/<pkg>` entry. Returns `null` when the module is not
 * running from an `npm install`-style layout (e.g. local source-tree dev).
 *
 * When OpenCode loads the plugin via `Npm.add()`, this resolves to the
 * per-spec sandbox (`<CACHE_ROOT>/packages/<sanitized-spec>/`), which is the
 * directory OpenCode actually reads on next restart. The flat
 * `<CACHE_ROOT>/packages/` path that the legacy update flow writes to never
 * intersects that sandbox — see #4318.
 */
function defaultGetModuleHostingWorkspace(): string | null {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    const pkgJsonPath = findPackageJsonUp(currentDir)
    if (!pkgJsonPath) return null
    const pkgDir = dirname(pkgJsonPath)
    const nodeModulesDir = dirname(pkgDir)
    if (nodeModulesDir.split(/[\\/]/).pop() !== "node_modules") return null
    return dirname(nodeModulesDir)
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    return null
  }
}

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
  syncCachePackageJsonToIntent: typeof syncCachePackageJsonToIntent
  showUpdateAvailableToast: typeof showUpdateAvailableToast
  showAutoUpdatedToast: typeof showAutoUpdatedToast
  /**
   * Returns the workspace directory hosting the currently loaded plugin
   * module, or `null` if the plugin is not running from a standard install
   * layout. Used to detect OpenCode-managed sandboxes (see #4318).
   */
  getModuleHostingWorkspace: () => string | null
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
  syncCachePackageJsonToIntent,
  showUpdateAvailableToast,
  showAutoUpdatedToast,
  getModuleHostingWorkspace: defaultGetModuleHostingWorkspace,
}

function getPinnedVersionToastMessage(latestVersion: string): string {
  return `Update available: ${latestVersion} (version pinned, update manually)`
}

/**
 * The plugin runs from an OpenCode-managed sandbox (`Npm.add()`-installed
 * `<CACHE_ROOT>/packages/<sanitized-spec>/`) whenever the module-hosting
 * workspace is **outside** both the flat cache workspace and the host
 * `configDir`. In that mode, OMO cannot reliably rewrite the install — even
 * if `bun install` succeeds against the flat cache path, OpenCode reads from
 * the sandbox on next restart and the version never switches (#4318).
 */
function isOpenCodeManagedSandbox(
  moduleWorkspace: string | null,
  cacheWorkspace: string,
  configDir: string,
): boolean {
  if (!moduleWorkspace) return false
  if (moduleWorkspace === cacheWorkspace) return false
  if (moduleWorkspace === configDir) return false
  return true
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

    const cachedVersion = deps.getCachedVersion()
    const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
    if (!currentVersion) {
      deps.log("[auto-update-checker] No version found (cached or pinned)")
      return
    }

    const channel = deps.extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
    const latestVersion = await deps.getLatestVersion(channel)
    if (!latestVersion) {
      deps.log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
      return
    }

    if (currentVersion === latestVersion) {
      deps.log("[auto-update-checker] Already on latest version for channel:", channel)
      return
    }

    deps.log(`[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`)

    if (!autoUpdate) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      deps.log("[auto-update-checker] Auto-update disabled, notification only")
      return
    }

    if (pluginInfo.isPinned) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, () => getPinnedVersionToastMessage(latestVersion))
      deps.log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
      return
    }

    // #4318: Detect OpenCode-managed sandbox installs and skip the legacy
    // install flow. OpenCode's `Npm.add()` reads the plugin from a per-spec
    // sandbox (`<CACHE_ROOT>/packages/<sanitized-spec>/node_modules/<pkg>/`),
    // not from the flat `<CACHE_ROOT>/packages/node_modules/<pkg>/` path the
    // legacy flow writes to. Running `bun install` against the flat path
    // succeeds but is never read on the next OpenCode start, so the user
    // sees an "Updated!" toast while the runtime keeps loading the old
    // version in an infinite restart loop.
    //
    // For sandbox installs we instead emit the truthful "update available"
    // toast and rely on OpenCode's own plugin reinstall path to apply the
    // new version.
    const moduleWorkspace = deps.getModuleHostingWorkspace()
    if (isOpenCodeManagedSandbox(moduleWorkspace, getCacheWorkspaceDir(deps), deps.getOpenCodeConfigPaths({ binary: "opencode" }).configDir)) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      deps.log(
        `[auto-update-checker] OpenCode-managed sandbox detected (${moduleWorkspace}); skipping auto-update install. Notification only. See #4318.`,
      )
      return
    }

    const syncResult = deps.syncCachePackageJsonToIntent(pluginInfo)
    if (syncResult.error) {
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
        await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
        deps.log("[auto-update-checker] cache workspace priming failed after install")
        return
      }

      await deps.showAutoUpdatedToast(ctx, currentVersion, latestVersion)
      deps.log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
      return
    }

    await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    deps.log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
  }
}

export const runBackgroundUpdateCheck = createBackgroundUpdateCheckRunner()
