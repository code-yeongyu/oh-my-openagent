import type { InstallConfig } from "../types"
import { generateModelConfig, type GenerateModelConfigOptions } from "../model-fallback"

export function generateOmoConfig(installConfig: InstallConfig, options: GenerateModelConfigOptions = {}): Record<string, unknown> {
  return generateModelConfig(installConfig, options)
}
