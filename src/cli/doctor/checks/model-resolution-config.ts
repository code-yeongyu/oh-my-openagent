import { readFileSync } from "node:fs"
import { join } from "node:path"
import { detectConfigFile, getOpenCodeConfigPaths, parseConfigContent, type ConfigFormat } from "../../../shared"
import type { OmoConfig } from "./model-resolution-types"

const PACKAGE_NAME = "oh-my-opencode"
const USER_CONFIG_BASE = join(
  getOpenCodeConfigPaths({ binary: "opencode", version: null }).configDir,
  PACKAGE_NAME
)
const PROJECT_CONFIG_BASE = join(process.cwd(), ".opencode", PACKAGE_NAME)

function loadConfigFromPath(path: string, format: Exclude<ConfigFormat, "none">): OmoConfig | null {
  try {
    const content = readFileSync(path, "utf-8")
    return parseConfigContent<OmoConfig>(content, format)
  } catch {
    return null
  }
}

export function loadOmoConfig(): OmoConfig | null {
  const projectDetected = detectConfigFile(PROJECT_CONFIG_BASE)
  if (projectDetected.format !== "none") {
    return loadConfigFromPath(projectDetected.path, projectDetected.format as Exclude<ConfigFormat, "none">)
  }

  const userDetected = detectConfigFile(USER_CONFIG_BASE)
  if (userDetected.format !== "none") {
    return loadConfigFromPath(userDetected.path, userDetected.format as Exclude<ConfigFormat, "none">)
  }

  return null
}
