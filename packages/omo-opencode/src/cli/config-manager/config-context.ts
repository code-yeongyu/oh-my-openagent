import { join } from "node:path"
import { getOpenCodeConfigPaths } from "../../shared"
import { resolveUserOmoConfigPath } from "@oh-my-opencode/omo-config-core"
import type {
  OpenCodeBinaryType,
  OpenCodeConfigPaths,
} from "../../shared/opencode-config-dir-types"

export interface ConfigContext {
  binary: OpenCodeBinaryType
  version: string | null
  paths: OpenCodeConfigPaths
}

let configContext: ConfigContext | null = null
let configDirOverride: string | null = null

export function initConfigContext(binary: OpenCodeBinaryType, version: string | null): void {
  const paths = getOpenCodeConfigPaths({ binary, version })
  configContext = { binary, version, paths }
}

export function getConfigContext(): ConfigContext {
  if (!configContext) {
    const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
    configContext = { binary: "opencode", version: null, paths }
  }
  return { ...configContext, paths: applyConfigDirOverride(configContext.paths) }
}

export function resetConfigContext(): void {
  configContext = null
  configDirOverride = null
}

export function setConfigDirOverride(configDir: string | null): void {
  configDirOverride = configDir
}

function applyConfigDirOverride(paths: OpenCodeConfigPaths): OpenCodeConfigPaths {
  if (!configDirOverride || configDirOverride === paths.configDir) return paths
  return {
    configDir: configDirOverride,
    configJson: join(configDirOverride, "opencode.json"),
    configJsonc: join(configDirOverride, "opencode.jsonc"),
    packageJson: join(configDirOverride, "package.json"),
  }
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
  return resolveUserOmoConfigPath()
}
