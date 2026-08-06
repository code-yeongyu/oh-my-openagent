import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  type TelemetryProductConfig,
} from "@oh-my-opencode/telemetry-core"
import packageJson from "../../package.json" with { type: "json" }

export { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST }

export const PRODUCT_NAME = "omo-codex"
export const PACKAGE_NAME = "@oh-my-opencode/omo-codex"
export const CACHE_DIR_NAME = "omo-codex"
export const EVENT_NAME = "omo_codex_daily_active"
export const LEGACY_PARENT_PACKAGE = "oh-my-opencode"
export const PRODUCT_ENV_PREFIX = "OMO_CODEX"
export const MACHINE_ID_PREFIX = "omo-codex:"

export function getProductVersion(): string {
  return packageJson.version
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
    machineIdPrefix: MACHINE_ID_PREFIX,
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
