import type { InstallPlatform } from "./types"

export const SENPI_PLATFORM_ENV_FLAG = "OMO_ENABLE_SENPI_PLATFORM"

export function isSenpiPlatformEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[SENPI_PLATFORM_ENV_FLAG]?.trim().toLowerCase()
  return value === "1" || value === "true"
}

export function availableInstallPlatforms(env: NodeJS.ProcessEnv = process.env): InstallPlatform[] {
  const platforms: InstallPlatform[] = ["opencode", "codex", "both"]
  if (isSenpiPlatformEnabled(env)) platforms.push("senpi")
  return platforms
}
