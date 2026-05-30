import type { InstallPlatform } from "./types"

export const LAZYCODEX_PUBLISH_FLAG = "OMO_PUBLISH_LAZYCODEX"
export const LAZYCODEX_DISABLED_MESSAGE =
  "Codex platform install is disabled. Set OMO_PUBLISH_LAZYCODEX=true to enable LazyCodex publish/install."

type Environment = Readonly<Record<string, string | undefined>>

export function isLazycodexPublishingEnabled(env: Environment = process.env): boolean {
  return env[LAZYCODEX_PUBLISH_FLAG] === "true"
}

export function platformRequiresLazycodex(platform: InstallPlatform | undefined): boolean {
  return platform === "codex" || platform === "both"
}
