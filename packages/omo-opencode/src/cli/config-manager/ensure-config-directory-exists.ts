import { existsSync, mkdirSync } from "node:fs"
import { getConfigDir } from "./config-context"

export function ensureConfigDirectoryExists(): void {
  const configDir = getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
}
