import { readFileSync } from "node:fs"
import { join } from "node:path"
import { detectPluginConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../../shared/plugin-identity"
import type { OmoConfig } from "./model-resolution-types"

const PROJECT_CONFIG_DIR = join(process.cwd(), ".opencode")

export function loadOmoConfig(): OmoConfig | null {
  const projectDetected = detectPluginConfigFile(PROJECT_CONFIG_DIR, {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
  if (projectDetected.format !== "none") {
    try {
      const content = readFileSync(projectDetected.path, "utf-8")
      return parseJsonc<OmoConfig>(content)
    } catch {
      return null
    }
  }

  const userConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  const userDetected = detectPluginConfigFile(userConfigDir, {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
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
