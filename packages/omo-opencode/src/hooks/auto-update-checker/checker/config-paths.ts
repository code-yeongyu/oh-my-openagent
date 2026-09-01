import * as os from "node:os"
import * as path from "node:path"
import {
  getUserConfigDir,
  getUserOpencodeConfig,
  getUserOpencodeConfigJsonc,
  getWindowsAppdataDir,
} from "../constants"

export function getConfigPaths(directory: string): string[] {
  const userConfigDir = getUserConfigDir()
  const paths = [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    getUserOpencodeConfig(),
    getUserOpencodeConfigJsonc(),
  ]

  if (process.platform === "win32") {
    const crossPlatformDir = path.join(os.homedir(), ".config")
    const appdataDir = getWindowsAppdataDir()

    if (appdataDir) {
      const alternateDir = userConfigDir === crossPlatformDir ? appdataDir : crossPlatformDir
      const alternateConfig = path.join(alternateDir, "opencode", "opencode.json")
      const alternateConfigJsonc = path.join(alternateDir, "opencode", "opencode.jsonc")

      if (!paths.includes(alternateConfig)) {
        paths.push(alternateConfig)
      }
      if (!paths.includes(alternateConfigJsonc)) {
        paths.push(alternateConfigJsonc)
      }
    }
  }

  return paths
}
