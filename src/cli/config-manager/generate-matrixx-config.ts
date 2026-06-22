import { generateModelConfig } from "../model-fallback"
import type { InstallConfig } from "../types"

export function generateMatrixxConfig(installConfig: InstallConfig): Record<string, unknown> {
  return generateModelConfig(installConfig)
}
