import { ensureDirectory } from "../../shared/ensure-directory"
import { getConfigDir } from "./config-context"

export function ensureConfigDirectoryExists(): void {
  const configDir = getConfigDir()
  ensureDirectory(configDir)
}
