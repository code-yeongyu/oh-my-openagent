export type { ConfigContext } from "./config-manager/config-context"
export {
  initConfigContext,
  getConfigContext,
  getConfigDir,
  resetConfigContext,
} from "./config-manager/config-context"

export { fetchNpmDistTags } from "./config-manager/npm-dist-tags"
export { getPluginNameWithVersion } from "./config-manager/plugin-name-with-version"
export { addPluginToOpenCodeConfig } from "./config-manager/add-plugin-to-opencode-config"
export {
  getOpenCodeCacheRootPath,
  getOpenCodePackagesCacheRootPath,
  getPackageNameFromPluginEntry,
  isLocalPluginEntry,
  resolvePluginCacheLocation,
} from "./config-manager/plugin-cache-entry"
export type { PluginCacheLocation } from "./config-manager/plugin-cache-entry"
export { inspectPluginCache } from "./config-manager/plugin-cache-health"
export type {
  PluginCacheInspection,
  PluginCacheStatus,
} from "./config-manager/plugin-cache-health"
export { repairPluginCache } from "./config-manager/plugin-cache-repair"
export type {
  PluginCacheRepairAttempt,
  PluginCacheRepairResult,
} from "./config-manager/plugin-cache-repair"

export { generateOmoConfig } from "./config-manager/generate-omo-config"
export { writeOmoConfig } from "./config-manager/write-omo-config"

export { isOpenCodeInstalled, getOpenCodeVersion } from "./config-manager/opencode-binary"

export { detectCurrentConfig } from "./config-manager/detect-current-config"

export type { BunInstallResult } from "./config-manager/bun-install"
export { runBunInstall, runBunInstallWithDetails } from "./config-manager/bun-install"
