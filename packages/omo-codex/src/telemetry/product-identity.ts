import packageJson from "../../package.json" with { type: "json" }

export const PRODUCT_NAME = "omo-codex"
export const PACKAGE_NAME = "@oh-my-opencode/omo-codex"
export const CACHE_DIR_NAME = "omo-codex"
export const EVENT_NAME = "omo_codex_daily_active"
export const LEGACY_PARENT_PACKAGE = "oh-my-opencode"
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"
export const DEFAULT_POSTHOG_API_KEY = "phc_CFJhj5HyvA62QPhvyaUCtaq23aUfznnijg5VaaGkNk74"

export function getProductVersion(): string {
  return packageJson.version
}
