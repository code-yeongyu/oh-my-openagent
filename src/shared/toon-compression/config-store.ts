import type { ToonCompressionConfig } from "./types"

export const DEFAULT_COMPRESSION_CONFIG: ToonCompressionConfig = {
  enabled: false,
  threshold: 5000,
}

let globalConfig: ToonCompressionConfig | undefined

export function setGlobalCompressionConfig(config: ToonCompressionConfig): void {
  globalConfig = config
}

export function getGlobalCompressionConfig(): ToonCompressionConfig {
  return globalConfig ?? DEFAULT_COMPRESSION_CONFIG
}

export function resetGlobalCompressionConfig(): void {
  globalConfig = undefined
}
