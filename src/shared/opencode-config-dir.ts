import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import type {
  OpenCodeBinaryType,
  OpenCodeConfigDirOptions,
  OpenCodeConfigPaths,
} from "./opencode-config-dir-types"

export type {
  OpenCodeBinaryType,
  OpenCodeConfigDirOptions,
  OpenCodeConfigPaths,
} from "./opencode-config-dir-types"

export const TAURI_APP_IDENTIFIER = "ai.opencode.desktop"
export const TAURI_APP_IDENTIFIER_DEV = "ai.opencode.desktop.dev"

export function isDevBuild(version: string | null | undefined): boolean {
  if (!version) return false
  return version.includes("-dev") || version.includes(".dev")
}

function getTauriConfigDir(identifier: string): string {
  const platform = process.platform

  switch (platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", identifier)

    case "win32": {
      const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      return join(appData, identifier)
    }

    case "linux":
    default: {
      const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
      return join(xdgConfig, identifier)
    }
  }
}

function getCliConfigDir(): string {
  const envConfigDir = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (envConfigDir) {
    return resolve(envConfigDir)
  }

  if (process.platform === "win32") {
    const crossPlatformDir = join(homedir(), ".config", "opencode")
    const crossPlatformConfig = join(crossPlatformDir, "opencode.json")

    if (existsSync(crossPlatformConfig)) {
      return crossPlatformDir
    }

    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming")
    const appdataDir = join(appData, "opencode")
    const appdataConfig = join(appdataDir, "opencode.json")

    if (existsSync(appdataConfig)) {
      return appdataDir
    }

    return crossPlatformDir
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "opencode")
}

export function getOpenCodeConfigDir(options: OpenCodeConfigDirOptions): string {
  const { binary, version, checkExisting = true } = options

  if (binary === "opencode") {
    return getCliConfigDir()
  }

  const identifier = isDevBuild(version) ? TAURI_APP_IDENTIFIER_DEV : TAURI_APP_IDENTIFIER
  const tauriDir = getTauriConfigDir(identifier)

  if (checkExisting) {
    const legacyDir = getCliConfigDir()
    const legacyConfig = join(legacyDir, "opencode.json")
    const legacyConfigC = join(legacyDir, "opencode.jsonc")

    if (existsSync(legacyConfig) || existsSync(legacyConfigC)) {
      return legacyDir
    }
  }

  return tauriDir
}

export function getOpenCodeConfigPaths(options: OpenCodeConfigDirOptions): OpenCodeConfigPaths {
  const configDir = getOpenCodeConfigDir(options)

  return {
    configDir,
    configJson: join(configDir, "opencode.json"),
    configJsonc: join(configDir, "opencode.jsonc"),
    packageJson: join(configDir, "package.json"),
    omoConfig: join(configDir, "oh-my-opencode.json"),
  }
}

export function detectExistingConfigDir(binary: OpenCodeBinaryType, version?: string | null): string | null {
  const locations: string[] = []

  const envConfigDir = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (envConfigDir) {
    locations.push(resolve(envConfigDir))
  }

  if (binary === "opencode-desktop") {
    const identifier = isDevBuild(version) ? TAURI_APP_IDENTIFIER_DEV : TAURI_APP_IDENTIFIER
    locations.push(getTauriConfigDir(identifier))

    if (isDevBuild(version)) {
      locations.push(getTauriConfigDir(TAURI_APP_IDENTIFIER))
    }
  }

  locations.push(getCliConfigDir())

  for (const dir of locations) {
    const configJson = join(dir, "opencode.json")
    const configJsonc = join(dir, "opencode.jsonc")

    if (existsSync(configJson) || existsSync(configJsonc)) {
      return dir
    }
  }

  return null
}
