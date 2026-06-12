import { createRequire } from "node:module"

const requireFromHere = createRequire(import.meta.url)

function resolvePublishedPackageName(): string {
  for (const candidate of [PLUGIN_NAME, LEGACY_PLUGIN_NAME]) {
    try {
      requireFromHere.resolve(`${candidate}/package.json`)
      return candidate
    } catch {
      // not installed under this name — try the next candidate
    }
  }
  return LEGACY_PLUGIN_NAME
}

export const PLUGIN_NAME = "oh-my-openagent"
export const LEGACY_PLUGIN_NAME = "oh-my-opencode"
export const ACCEPTED_PACKAGE_NAMES = [PLUGIN_NAME, LEGACY_PLUGIN_NAME] as const
export const PUBLISHED_PACKAGE_NAME = resolvePublishedPackageName()
export const CONFIG_BASENAME = "oh-my-openagent"
export const LEGACY_CONFIG_BASENAME = "oh-my-opencode"
export const LOG_FILENAME = "oh-my-opencode.log"
export const CACHE_DIR_NAME = "oh-my-opencode"
