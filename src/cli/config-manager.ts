export { addPluginToOpenCodeConfig } from "./config-manager/add-plugin-to-opencode-config"
export { addProviderConfig } from "./config-manager/add-provider-config"
export { ANTIGRAVITY_PROVIDER_CONFIG } from "./config-manager/antigravity-provider-configuration"
export { addAuthPlugins, fetchLatestVersion } from "./config-manager/auth-plugins"
export type { BunInstallResult } from "./config-manager/bun-install"
export { runBunInstall, runBunInstallWithDetails } from "./config-manager/bun-install"
export type { ConfigContext } from "./config-manager/config-context"
export {
  getConfigContext,
  initConfigContext,
  resetConfigContext,
} from "./config-manager/config-context"
export { detectCurrentConfig } from "./config-manager/detect-current-config"
export { generateMatrixxConfig } from "./config-manager/generate-matrixx-config"
export { fetchNpmDistTags } from "./config-manager/npm-dist-tags"
export { getOpenCodeVersion, isOpenCodeInstalled } from "./config-manager/opencode-binary"
export { getPluginNameWithVersion } from "./config-manager/plugin-name-with-version"
export { writeMatrixxConfig } from "./config-manager/write-matrixx-config"
