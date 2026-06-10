import {
  getOpenCodeConfigPaths,
  detectPluginConfigFile,
  initConfigContext as sharedInitConfigContext,
  getConfigContext as sharedGetConfigContext,
  resetConfigContext as sharedResetConfigContext,
  type ConfigContext as SharedConfigContext,
  type OpenCodeBinaryType,
} from "../../shared"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../shared/plugin-identity"

export type ConfigContext = SharedConfigContext

export function initConfigContext(binary: OpenCodeBinaryType, version: string | null): void {
  sharedInitConfigContext(binary, version)
}

export function getConfigContext(): ConfigContext {
  return sharedGetConfigContext()
}

export function resetConfigContext(): void {
  sharedResetConfigContext()
}

export function getConfigDir(): string {
  return getConfigContext().paths.configDir
}

export function getConfigJson(): string {
  return getConfigContext().paths.configJson
}

export function getConfigJsonc(): string {
  return getConfigContext().paths.configJsonc
}

export function getOmoConfigPath(): string {
  const configDir = getConfigContext().paths.configDir
  const detected = detectPluginConfigFile(configDir, {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
  if (detected.format !== "none") return detected.path
  return getConfigContext().paths.omoConfig
}
