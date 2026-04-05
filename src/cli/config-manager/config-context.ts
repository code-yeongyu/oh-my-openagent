import { basename, extname, join } from "node:path"

import { getOpenCodeConfigPaths } from "../../shared"
import { detectPluginConfigFile } from "../../shared/jsonc-parser"
import { migrateLegacyConfigFile } from "../../shared/migrate-legacy-config-file"
import type {
  OpenCodeBinaryType,
  OpenCodeConfigPaths,
} from "../../shared/opencode-config-dir-types"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../shared/plugin-identity"

export interface ConfigContext {
  binary: OpenCodeBinaryType
  version: string | null
  paths: OpenCodeConfigPaths
}

let configContext: ConfigContext | null = null

export function initConfigContext(binary: OpenCodeBinaryType, version: string | null): void {
  const paths = getOpenCodeConfigPaths({ binary, version })
  configContext = { binary, version, paths }
}

export function getConfigContext(): ConfigContext {
  if (!configContext) {
    const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
    configContext = { binary: "opencode", version: null, paths }
  }
  return configContext
}

export function resetConfigContext(): void {
  configContext = null
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
  const detectedConfig = detectPluginConfigFile(configDir)

  if (
    detectedConfig.format !== "none"
    && basename(detectedConfig.path).startsWith(LEGACY_CONFIG_BASENAME)
  ) {
    const canonicalPath = join(
      configDir,
      `${CONFIG_BASENAME}${extname(detectedConfig.path)}`,
    )
    const migrated = migrateLegacyConfigFile(detectedConfig.path)
    return migrated ? canonicalPath : detectedConfig.path
  }

  return detectedConfig.path
}
