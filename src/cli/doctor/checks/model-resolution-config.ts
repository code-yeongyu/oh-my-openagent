import { readFileSync } from "node:fs"
import { join } from "node:path"
import { detectConfigFile, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"
import type { MatrixxConfig } from "./model-resolution-types"

const PACKAGE_NAME = "matrixx"
const USER_CONFIG_BASE = join(
  getOpenCodeConfigPaths({ binary: "opencode", version: null }).configDir,
  PACKAGE_NAME
)
const PROJECT_CONFIG_BASE = join(process.cwd(), ".opencode", PACKAGE_NAME)

export function loadMatrixxConfig(): MatrixxConfig | null {
  const projectDetected = detectConfigFile(PROJECT_CONFIG_BASE)
  if (projectDetected.format !== "none") {
    try {
      const content = readFileSync(projectDetected.path, "utf-8")
      return parseJsonc<MatrixxConfig>(content)
    } catch {
      return null
    }
  }

  const userDetected = detectConfigFile(USER_CONFIG_BASE)
  if (userDetected.format !== "none") {
    try {
      const content = readFileSync(userDetected.path, "utf-8")
      return parseJsonc<MatrixxConfig>(content)
    } catch {
      return null
    }
  }

  return null
}
