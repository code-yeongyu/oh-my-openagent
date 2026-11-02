import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  getOpenCodeCacheDir,
  getPluginSandboxDir,
  hasOtherLivePluginSandboxLease,
  log,
  markPluginSandboxStale,
  parseJsonc,
  removePluginSandbox,
} from "../../shared"
import { getConfigDir } from "./config-context"

/**
 * Clears OpenCode's plugin sandbox for the spec(s) the installer just wrote.
 *
 * OpenCode serves the plugin from `<cache>/packages/<spec>/` and its
 * `Npm.add()` never re-resolves the tag while that sandbox exists, so a user
 * who re-runs the installer to upgrade would keep loading the version cached
 * there. The next OpenCode start reinstalls the spec at its current version.
 *
 * The installer is often run while OpenCode is open (from another terminal, or
 * by the agent itself), and a live session reads from the sandbox lazily. A
 * sandbox another process holds a lease on is therefore only marked for
 * refresh; the last OpenCode process to exit removes it.
 *
 * Only the specs the config actually loads are touched, so an unrelated
 * channel a user keeps around (`@beta` next to `@latest`) is left alone.
 */

export interface RefreshOpenCodePluginSandboxesOptions {
  readonly configDir?: string
  readonly cacheDir?: string
}

export interface RefreshOpenCodePluginSandboxesResult {
  readonly removed: readonly string[]
  /** Sandboxes a running OpenCode still uses; they refresh when it exits. */
  readonly deferred: readonly string[]
  /** Sandboxes that could not be removed; the caller must tell the user. */
  readonly failed: readonly { readonly dir: string; readonly message: string }[]
}

type ConfigShape = {
  readonly plugin?: readonly unknown[]
}

function readPluginEntries(configDir: string): readonly string[] {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const configPath = join(configDir, name)
    if (!existsSync(configPath)) continue
    try {
      const parsed = parseJsonc<ConfigShape>(readFileSync(configPath, "utf-8"))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      return (parsed.plugin ?? []).filter((entry): entry is string => typeof entry === "string")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      log(`[install] Could not read plugin entries from ${configPath}: ${error.message}`)
    }
  }
  return []
}

export function refreshOpenCodePluginSandboxes(
  options: RefreshOpenCodePluginSandboxesOptions = {},
): RefreshOpenCodePluginSandboxesResult {
  // The same config dir the installer just wrote to, so a profile or a
  // non-default binary layout refreshes the spec it actually loads.
  const configDir = options.configDir ?? getConfigDir()
  const cacheDir = options.cacheDir ?? getOpenCodeCacheDir()

  const removed: string[] = []
  const deferred: string[] = []
  const failed: { dir: string; message: string }[] = []
  for (const entry of readPluginEntries(configDir)) {
    const sandboxDir = getPluginSandboxDir(cacheDir, entry)
    if (!sandboxDir) continue
    try {
      if (hasOtherLivePluginSandboxLease(sandboxDir) && markPluginSandboxStale(sandboxDir, cacheDir)) {
        deferred.push(sandboxDir)
        log(`[install] OpenCode is running from ${sandboxDir}; marked it for refresh when OpenCode exits`)
        continue
      }
      if (!removePluginSandbox(sandboxDir, cacheDir)) continue
      removed.push(sandboxDir)
      log(`[install] Removed stale OpenCode plugin sandbox: ${sandboxDir}`)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      failed.push({ dir: sandboxDir, message: error.message })
      log(`[install] Failed to remove OpenCode plugin sandbox ${sandboxDir}: ${error.message}`)
    }
  }

  return { removed, deferred, failed }
}
