import { createRequire } from "node:module"

export const PLUGIN_NAME = "oh-my-openagent"
export const LEGACY_PLUGIN_NAME = "oh-my-opencode"

function resolvePublishedPackageName(): string {
  try {
    const require = createRequire(import.meta.url)
    require.resolve("oh-my-openagent/package.json")
    return "oh-my-openagent"
  } catch {
    return "oh-my-opencode"
  }
}

export const PUBLISHED_PACKAGE_NAME = resolvePublishedPackageName()
export const ACCEPTED_PACKAGE_NAMES = [LEGACY_PLUGIN_NAME, PLUGIN_NAME] as const
export const CONFIG_BASENAME = "oh-my-openagent"
export const LEGACY_CONFIG_BASENAME = "oh-my-opencode"
export const LOG_FILENAME = "oh-my-opencode.log"
export const CACHE_DIR_NAME = "oh-my-opencode"
