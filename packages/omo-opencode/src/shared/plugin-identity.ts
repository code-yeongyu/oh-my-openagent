import { createProductIdentity } from "@oh-my-opencode/utils"

const PRODUCT_IDENTITY = createProductIdentity({
  pluginName: "oh-my-openagent",
  legacyPluginName: "oh-my-opencode",
  publishedPackageName: "oh-my-openagent",
  acceptedPackageNames: ["oh-my-openagent", "oh-my-opencode"],
  configBasename: "oh-my-openagent",
  legacyConfigBasename: "oh-my-opencode",
  logFileName: "oh-my-opencode.log",
  cacheDirName: "oh-my-opencode",
})

export const PLUGIN_NAME = PRODUCT_IDENTITY.pluginName
export const LEGACY_PLUGIN_NAME = PRODUCT_IDENTITY.legacyPluginName
export const PUBLISHED_PACKAGE_NAME = PRODUCT_IDENTITY.publishedPackageName
export const ACCEPTED_PACKAGE_NAMES = PRODUCT_IDENTITY.acceptedPackageNames
export const CONFIG_BASENAME = PRODUCT_IDENTITY.configBasename
export const LEGACY_CONFIG_BASENAME = PRODUCT_IDENTITY.legacyConfigBasename
export const LOG_FILENAME = PRODUCT_IDENTITY.logFileName
export const CACHE_DIR_NAME = PRODUCT_IDENTITY.cacheDirName
