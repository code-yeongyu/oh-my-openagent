import * as path from "path"
import * as os from "os"

/**
 * Returns the user-level config directory based on the OS.
 * - Linux/macOS: XDG_CONFIG_HOME or ~/.config
 * - Windows: %APPDATA%
 */
export function getUserConfigDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
  }

  // Linux, macOS, and other Unix-like systems: respect XDG_CONFIG_HOME
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
