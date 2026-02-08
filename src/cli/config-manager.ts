export type { ConfigContext } from "./config-manager/config-context"
export {
  initConfigContext,
  getConfigContext,
  resetConfigContext,
} from "./config-manager/config-context"

export { fetchNpmDistTags } from "./config-manager/npm-dist-tags"
export { getPluginNameWithVersion } from "./config-manager/plugin-name-with-version"
export { addPluginToOpenCodeConfig } from "./config-manager/add-plugin-to-opencode-config"

export { generateOmoConfig } from "./config-manager/generate-omo-config"
export { writeOmoConfig } from "./config-manager/write-omo-config"

export { isOpenCodeInstalled, getOpenCodeVersion } from "./config-manager/opencode-binary"

export { fetchLatestVersion, addAuthPlugins } from "./config-manager/auth-plugins"
export { ANTIGRAVITY_PROVIDER_CONFIG } from "./config-manager/antigravity-provider-configuration"
export { addProviderConfig } from "./config-manager/add-provider-config"
export { detectCurrentConfig } from "./config-manager/detect-current-config"

export type { BunInstallResult } from "./config-manager/bun-install"
export { runBunInstall, runBunInstallWithDetails } from "./config-manager/bun-install"
