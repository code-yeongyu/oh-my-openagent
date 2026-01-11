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
    // Check JSONC first, then JSON
    const crossPlatformConfigPathJsonc = path.join(crossPlatformDir, "opencode", "oh-my-opencode.jsonc")
    const crossPlatformConfigPathJson = path.join(crossPlatformDir, "opencode", "oh-my-opencode.json")

    const appdataDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    const appdataConfigPathJsonc = path.join(appdataDir, "opencode", "oh-my-opencode.jsonc")
    const appdataConfigPathJson = path.join(appdataDir, "opencode", "oh-my-opencode.json")

    // Priority: ~/.config (JSONC > JSON) > %APPDATA% (JSONC > JSON)
    if (fs.existsSync(crossPlatformConfigPathJsonc) || fs.existsSync(crossPlatformConfigPathJson)) {
      return crossPlatformDir
    }

    if (fs.existsSync(appdataConfigPathJsonc) || fs.existsSync(appdataConfigPathJson)) {
      return appdataDir
    }

    return crossPlatformDir
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}

/**
 * Returns the full path to the user-level oh-my-opencode config file.
 * Checks for .jsonc first, then .json
 */
export function getUserConfigPath(): string {
  const dir = path.join(getUserConfigDir(), "opencode")
  const jsoncPath = path.join(dir, "oh-my-opencode.jsonc")
  if (fs.existsSync(jsoncPath)) {
    return jsoncPath
  }
  return path.join(dir, "oh-my-opencode.json")
}

/**
 * Returns the full path to the project-level oh-my-opencode config file.
 * Checks for .jsonc first, then .json
 */
export function getProjectConfigPath(directory: string): string {
  const dir = path.join(directory, ".opencode")
  const jsoncPath = path.join(dir, "oh-my-opencode.jsonc")
  if (fs.existsSync(jsoncPath)) {
    return jsoncPath
  }
  return path.join(dir, "oh-my-opencode.json")
}
