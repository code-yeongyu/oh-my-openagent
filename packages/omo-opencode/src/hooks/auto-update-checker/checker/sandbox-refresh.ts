import { basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { log } from "../../../shared/logger"
import { getOpenCodeCacheDir } from "../../../shared/data-path"
import {
  acquirePluginSandboxLease,
  describeUnappliedPluginSandboxRefresh,
  hasOtherLivePluginSandboxLease,
  isPluginSandboxDir,
  isPluginSandboxMarkedStale,
  markPluginSandboxStale,
  releasePluginSandboxLease,
  removePluginSandbox,
} from "../../../shared/opencode-plugin-sandbox"
import { findPackageJsonUp } from "./package-json-locator"

/**
 * Makes "restart to apply" true for a plugin running from an OpenCode-managed
 * sandbox.
 *
 * OpenCode's `Npm.add()` serves the plugin from `<cache>/packages/<spec>/` and
 * skips resolution entirely while that sandbox exists, so a restart alone
 * reloads the same old version forever. Removing the sandbox is the only way
 * to make the next start install the channel's current version.
 *
 * Removal waits for process exit because the live session still reads from
 * that directory — bundled skills, the `./tui` export, provisioned binaries
 * and any lazily imported chunk all resolve inside it.
 *
 * Detection and removal run in different threads. In the TUI, OpenCode runs
 * the server plugin (and so this checker) inside a Worker it stops with
 * `worker.terminate()`, and a terminated Worker never emits `exit`. Only the
 * main thread, where the TUI plugin (`./tui`) lives, runs exit handlers. So the
 * checker records the request as a marker file in the sandbox, and every
 * plugin entry point loaded from a sandbox (server and TUI) registers the
 * exit handler that acts on it. A process that dies from a signal runs no
 * handler; the marker stays and the next exit applies it.
 *
 * Every OpenCode window shares the one cache, so tracking also takes a
 * per-process lease on the sandbox, and the exit handler leaves the sandbox
 * (and the request) in place while another live process holds one: the last
 * OpenCode process to exit applies the refresh.
 */

export interface SandboxRefreshDeps {
  /** Registers a callback for process exit. Defaults to `process.once("exit")`. */
  onExit?: (callback: () => void) => void
  /** The OpenCode cache root that must contain the sandbox. */
  cacheDir?: string
  /** The pid the lease is taken for. Defaults to `process.pid`. */
  pid?: number
}

const trackedSandboxDirs = new Set<string>()

/**
 * The OpenCode plugin sandbox the module at `moduleUrl` was loaded from, or
 * null for any other layout (project or global install, linked checkout,
 * source tree).
 */
export function getLoadedPluginSandboxDir(moduleUrl: string, cacheDir: string = getOpenCodeCacheDir()): string | null {
  const packageJsonPath = findPackageJsonUp(dirname(fileURLToPath(moduleUrl)))
  if (!packageJsonPath) return null
  const nodeModulesDir = dirname(dirname(packageJsonPath))
  if (basename(nodeModulesDir) !== "node_modules") return null
  const workspace = dirname(nodeModulesDir)
  return isPluginSandboxDir(workspace, cacheDir) ? workspace : null
}

function refreshMarkedSandbox(sandboxDir: string, cacheDir: string, pid: number): void {
  try {
    releasePluginSandboxLease(sandboxDir, pid)
    if (!isPluginSandboxMarkedStale(sandboxDir)) return
    if (hasOtherLivePluginSandboxLease(sandboxDir, pid)) {
      markPluginSandboxStale(sandboxDir, cacheDir, "another OpenCode window was still open", pid)
      log(`[auto-update-checker] Another OpenCode process still runs from ${sandboxDir}; the last one to exit refreshes it`)
      return
    }
    const removed = removePluginSandbox(sandboxDir, cacheDir)
    log(
      removed
        ? `[auto-update-checker] Removed stale OpenCode plugin sandbox on exit: ${sandboxDir}`
        : `[auto-update-checker] OpenCode plugin sandbox already gone: ${sandboxDir}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`[auto-update-checker] Failed to remove OpenCode plugin sandbox ${sandboxDir}: ${message}`)
    // The removal is atomic, so the sandbox and its marker are intact; record
    // why, and the next start reports it instead of repeating "restart".
    try {
      markPluginSandboxStale(sandboxDir, cacheDir, `could not remove it: ${message}`, pid)
    } catch (markError) {
      log(`[auto-update-checker] Could not record the failed refresh of ${sandboxDir}:`, markError)
    }
  }
}

/** Registers the exit handler that removes the sandbox if a refresh was requested. */
export function trackPluginSandbox(sandboxDir: string, deps: SandboxRefreshDeps = {}): boolean {
  const cacheDir = deps.cacheDir ?? getOpenCodeCacheDir()
  if (!isPluginSandboxDir(sandboxDir, cacheDir)) return false
  if (trackedSandboxDirs.has(sandboxDir)) return true
  trackedSandboxDirs.add(sandboxDir)

  const pid = deps.pid ?? process.pid
  try {
    acquirePluginSandboxLease(sandboxDir, pid)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`[auto-update-checker] Could not lease OpenCode plugin sandbox ${sandboxDir}: ${message}`)
  }
  const onExit = deps.onExit ?? ((callback: () => void) => process.once("exit", callback))
  onExit(() => refreshMarkedSandbox(sandboxDir, cacheDir, pid))
  return true
}

/** Entry-point helper for the server and TUI plugins: track the sandbox this bundle runs from, if any. */
export function trackLoadedPluginSandbox(moduleUrl: string = import.meta.url): void {
  try {
    const sandboxDir = getLoadedPluginSandboxDir(moduleUrl)
    if (sandboxDir) trackPluginSandbox(sandboxDir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`[auto-update-checker] Could not track the OpenCode plugin sandbox: ${message}`)
  }
}

/**
 * Requests the exit-time refresh of `sandboxDir`. Returns why an earlier
 * request was not applied (see `describeUnappliedPluginSandboxRefresh`), so the
 * caller can tell the user a plain restart will not help; null otherwise.
 */
export function scheduleOpenCodeSandboxRefreshOnExit(sandboxDir: string, deps: SandboxRefreshDeps = {}): string | null {
  const cacheDir = deps.cacheDir ?? getOpenCodeCacheDir()
  if (!isPluginSandboxDir(sandboxDir, cacheDir)) {
    log(`[auto-update-checker] Not an OpenCode plugin sandbox, leaving it alone: ${sandboxDir}`)
    return null
  }

  const pid = deps.pid ?? process.pid
  let unapplied: string | null
  try {
    unapplied = describeUnappliedPluginSandboxRefresh(sandboxDir, pid)
    markPluginSandboxStale(sandboxDir, cacheDir, "", pid)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`[auto-update-checker] Could not request a refresh of OpenCode plugin sandbox ${sandboxDir}: ${message}`)
    return `could not request it: ${message}`
  }
  trackPluginSandbox(sandboxDir, { ...deps, cacheDir })
  log(`[auto-update-checker] Scheduled OpenCode plugin sandbox refresh on exit: ${sandboxDir}`)
  return unapplied
}
