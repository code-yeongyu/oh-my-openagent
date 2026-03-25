import { readFileSync } from "node:fs"
import { join } from "node:path"
import { detectPluginConfigFile, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"
import type { OmoConfig } from "./model-resolution-types"

const USER_CONFIG_DIR = getOpenCodeConfigPaths({ binary: "opencode", version: null }).configDir
const PROJECT_CONFIG_DIR = join(process.cwd(), ".opencode")

export function loadOmoConfig(): OmoConfig | null {
  const projectDetected = detectPluginConfigFile(PROJECT_CONFIG_DIR)
  if (projectDetected.format !== "none") {
    try {
      const content = readFileSync(projectDetected.path, "utf-8")
      return parseJsonc<OmoConfig>(content)
    } catch {
      return null
    }
  }

  const userDetected = detectPluginConfigFile(USER_CONFIG_DIR)
  if (userDetected.format !== "none") {
    try {
      const content = readFileSync(userDetected.path, "utf-8")
      return parseJsonc<OmoConfig>(content)
    } catch {
      return null
    }
  }

  return null
}
