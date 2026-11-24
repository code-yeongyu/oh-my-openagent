import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  type TelemetryProductConfig,
} from "@oh-my-opencode/telemetry-core"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST }

export const PRODUCT_NAME = "omo-codex"
export const PACKAGE_NAME = "@oh-my-opencode/omo-codex"
export const CACHE_DIR_NAME = "omo-codex"
export const EVENT_NAME = "omo_codex_daily_active"
export const LEGACY_PARENT_PACKAGE = "oh-my-opencode"
export const PRODUCT_ENV_PREFIX = "OMO_CODEX"

/**
 * The omo-codex version, read when asked from the Codex plugin manifest (`packages/omo-codex/plugin/package.json`), which
 * the release stamp versions together with `packages/omo-codex/package.json`. It sits two levels above both places this
 * code runs from: `src/telemetry/` in a checkout and the committed installer bundle in `scripts/install-dist/`, which the
 * oh-my-opencode and lazycodex-ai packages ship with the plugin but without the omo-codex manifest. Never compiled in, so
 * a release stamp leaves the committed installer bundle unchanged (#14867).
 */
export function getProductVersion(moduleUrl: string = import.meta.url): string {
  const manifestPath = join(dirname(fileURLToPath(moduleUrl)), "..", "..", "plugin", "package.json")
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  const version = manifest !== null && typeof manifest === "object" ? Reflect.get(manifest, "version") : undefined
  if (typeof version !== "string") throw new Error(`omo-codex plugin manifest has no version: ${manifestPath}`)
  return version
}

export function createCodexTelemetryProductConfig(
  packageVersion: string = getProductVersion(),
  additionalProperties?: TelemetryProductConfig["additionalProperties"],
): TelemetryProductConfig {
  const product = {
    cacheDirName: CACHE_DIR_NAME,
    defaultApiKey: DEFAULT_POSTHOG_API_KEY,
    defaultHost: DEFAULT_POSTHOG_HOST,
    eventName: EVENT_NAME,
    packageName: PACKAGE_NAME,
    packageVersion,
    platform: "omo-codex",
    productEnvPrefix: PRODUCT_ENV_PREFIX,
    productName: PRODUCT_NAME,
  }

  if (additionalProperties === undefined) {
    return product
  }

  return {
    ...product,
    additionalProperties,
  }
}
