import type { InstallPlatform } from "./types"

export const NATIVE_DEV_PLATFORM_ENV_FLAG = "OMO_ENABLE_NATIVE_DEV_PLATFORM"
export const LEGACY_NATIVE_DEV_PLATFORM_ENV_FLAG = "OMO_ENABLE_SENPI_PLATFORM"

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === "1" || normalized === "true"
}

export function isNativeDevPlatformEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env[NATIVE_DEV_PLATFORM_ENV_FLAG]) || isTruthy(env[LEGACY_NATIVE_DEV_PLATFORM_ENV_FLAG])
}

export function availableInstallPlatforms(env: NodeJS.ProcessEnv = process.env): InstallPlatform[] {
  const platforms: InstallPlatform[] = ["opencode", "codex", "both", "native"]
  if (isNativeDevPlatformEnabled(env)) platforms.push("native-dev")
  return platforms
}
