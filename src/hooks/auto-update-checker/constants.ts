import * as path from "node:path"
import * as os from "node:os"
import * as fs from "node:fs"

export const PACKAGE_NAME = "oh-my-opencode"
export const NPM_REGISTRY_URL = `https://registry.npmjs.org/-/package/${PACKAGE_NAME}/dist-tags`
export const NPM_FETCH_TIMEOUT = 5000

/**
 * OpenCode plugin cache directory
 * - Linux/macOS: ~/.cache/opencode/
 * - Windows: %LOCALAPPDATA%/opencode/
 */
function getCacheDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? os.homedir(), "opencode")
  }
  return path.join(os.homedir(), ".cache", "opencode")
}

export const CACHE_DIR = getCacheDir()
export const VERSION_FILE = path.join(CACHE_DIR, "version")
export const INSTALLED_PACKAGE_JSON = path.join(
  CACHE_DIR,
  "node_modules",
  PACKAGE_NAME,
  "package.json"
)

/**
 * OpenCode config file locations (priority order)
 * On Windows, checks ~/.config first (cross-platform), then %APPDATA% (fallback)
 * This matches shared/config-path.ts behavior for consistency
 */
function getUserConfigDir(): string {
  if (process.platform === "win32") {
    const crossPlatformDir = path.join(os.homedir(), ".config")
    const appdataDir = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
    
    // Check cross-platform path first (~/.config)
    const crossPlatformConfig = path.join(crossPlatformDir, "opencode", "opencode.json")
    const crossPlatformConfigJsonc = path.join(crossPlatformDir, "opencode", "opencode.jsonc")
    
    if (fs.existsSync(crossPlatformConfig) || fs.existsSync(crossPlatformConfigJsonc)) {
      return crossPlatformDir
    }
    
    // Fall back to %APPDATA%
    return appdataDir
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
}

/**
 * Get the Windows-specific APPDATA directory (for fallback checks)
 */
export function getWindowsAppdataDir(): string | null {
  if (process.platform !== "win32") return null
  return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
}

export const USER_CONFIG_DIR = getUserConfigDir()
export const USER_OPENCODE_CONFIG = path.join(USER_CONFIG_DIR, "opencode", "opencode.json")
export const USER_OPENCODE_CONFIG_JSONC = path.join(USER_CONFIG_DIR, "opencode", "opencode.jsonc")
