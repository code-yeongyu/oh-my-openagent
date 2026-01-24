import * as path from "path"
import * as os from "os"
import * as fs from "fs"

/**
 * Returns the user-level config directory based on the OS.
 * @deprecated Use getOpenCodeConfigDir() from opencode-config-dir.ts instead.
 */
export function getUserConfigDir(): string {
  if (process.platform === "win32") {
    const crossPlatformDir = path.join(os.homedir(), ".config")
    const crossPlatformConfigPath = path.join(crossPlatformDir, "opencode", "oh-my-opencode.json")

    const appdataDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    const appdataConfigPath = path.join(appdataDir, "opencode", "oh-my-opencode.json")

    if (fs.existsSync(crossPlatformConfigPath)) {
      return crossPlatformDir
    }

    if (fs.existsSync(appdataConfigPath)) {
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
