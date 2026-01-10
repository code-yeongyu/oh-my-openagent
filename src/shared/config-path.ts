import * as path from "path"
import * as os from "os"
import * as fs from "fs"

/**
 * Returns the user-level config directory based on the OS.
 * - Linux/macOS: XDG_CONFIG_HOME or ~/.config
 * - Windows: Checks ~/.config first (cross-platform), then %APPDATA% (fallback)
 *
 * On Windows, prioritizes ~/.config for cross-platform consistency.
 * Falls back to %APPDATA% for backward compatibility with existing installations.
 */
export function getUserConfigDir(): string {
  if (process.platform === "win32") {
    const crossPlatformDir = path.join(os.homedir(), ".config")
    const crossPlatformConfigJson = path.join(crossPlatformDir, "opencode", "oh-my-opencode.json")
    const crossPlatformConfigJsonc = path.join(crossPlatformDir, "opencode", "oh-my-opencode.jsonc")

    const appdataDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    const appdataConfigJson = path.join(appdataDir, "opencode", "oh-my-opencode.json")
    const appdataConfigJsonc = path.join(appdataDir, "opencode", "oh-my-opencode.jsonc")

    // Check cross-platform location first (both .jsonc and .json)
    if (fs.existsSync(crossPlatformConfigJsonc) || fs.existsSync(crossPlatformConfigJson)) {
      return crossPlatformDir
    }

    // Check APPDATA location (both .jsonc and .json)
    if (fs.existsSync(appdataConfigJsonc) || fs.existsSync(appdataConfigJson)) {
      return appdataDir
    }

    return crossPlatformDir
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}

/**
 * Returns the full path to the user-level oh-my-opencode config file.
 */
export function getUserConfigPath(): string {
  return path.join(getUserConfigDir(), "opencode", "oh-my-opencode.json")
}

/**
 * Returns the full path to the project-level oh-my-opencode config file.
 */
export function getProjectConfigPath(directory: string): string {
  return path.join(directory, ".opencode", "oh-my-opencode.json")
}
